"""WAV duration extraction used to unlock the mixer immediately."""

from __future__ import annotations

import wave
from pathlib import Path

from backend.config import Settings
from backend.jobs import DEMUCS_MODEL, JobRecord
from backend.library import LibraryJobManager
from backend.schemas import JobStatus


def test_duration_is_read_from_wav_header(tmp_path: Path) -> None:
    settings = Settings(
        job_root=tmp_path / "jobs",
        frontend_dir=tmp_path / "front",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    manager = LibraryJobManager(settings)
    job_id = "duration-job"
    input_path = settings.job_root / job_id / "input" / "source.mp3"
    stem_path = (
        settings.job_root
        / job_id
        / "separated"
        / DEMUCS_MODEL
        / "source"
        / "vocals.wav"
    )
    stem_path.parent.mkdir(parents=True)
    with wave.open(str(stem_path), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(44100)
        audio.writeframes(b"\0\0\0\0" * 88200)
    record = JobRecord(
        job_id=job_id,
        status=JobStatus.COMPLETED.value,
        original_name="audio.mp3",
        input_path=str(input_path),
        content_type="audio/mpeg",
        size_bytes=10,
        created_at=1.0,
    )
    try:
        assert manager.get_duration(record) == 2.0
        assert manager.get_duration(record) == 2.0
    finally:
        manager.shutdown()

