"""Completed-job library and secure stem path resolution."""

from __future__ import annotations

import wave
from dataclasses import asdict
from pathlib import Path

from backend.jobs import DEMUCS_MODEL, STEMS, JobRecord
from backend.resilient_jobs import ResilientProgressJobManager
from backend.schemas import JobStatus


class LibraryJobManager(ResilientProgressJobManager):
    """Expose read-only library operations over persisted completed jobs."""

    def __init__(self, *args, **kwargs) -> None:
        self._duration_cache: dict[str, float | None] = {}
        super().__init__(*args, **kwargs)

    def list_completed(self) -> list[JobRecord]:
        """Return completed jobs newest first."""
        with self._lock:
            records = [
                JobRecord(**asdict(record))
                for record in self._records.values()
                if record.status == JobStatus.COMPLETED.value
                and self.output_path(record) is not None
            ]
        return sorted(
            records,
            key=lambda record: record.finished_at or record.created_at,
            reverse=True,
        )

    def get_stem_path(self, record: JobRecord, stem: str) -> Path | None:
        """Resolve one of the six known stems within the job directory."""
        if stem not in STEMS or record.status != JobStatus.COMPLETED.value:
            return None
        input_stem = Path(record.input_path).stem
        stem_path = (
            self.settings.job_root
            / record.job_id
            / "separated"
            / DEMUCS_MODEL
            / input_stem
            / f"{stem}.wav"
        )
        job_dir = (self.settings.job_root / record.job_id).resolve()
        try:
            stem_path.resolve().relative_to(job_dir)
        except ValueError:
            return None
        return (
            stem_path
            if stem_path.is_file() and stem_path.stat().st_size > 0
            else None
        )

    def get_duration(self, record: JobRecord) -> float | None:
        """Read duration from one PCM WAV header without loading audio data."""
        if record.job_id in self._duration_cache:
            return self._duration_cache[record.job_id]

        duration: float | None = None
        for stem in STEMS:
            stem_path = self.get_stem_path(record, stem)
            if stem_path is None:
                continue
            try:
                with wave.open(str(stem_path), "rb") as audio:
                    frame_rate = audio.getframerate()
                    if frame_rate > 0:
                        duration = audio.getnframes() / frame_rate
            except (OSError, EOFError, wave.Error):
                duration = None
            break

        self._duration_cache[record.job_id] = duration
        return duration

