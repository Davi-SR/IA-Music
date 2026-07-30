"""Progress behavior tests independent of Demucs and network access."""

from __future__ import annotations

from pathlib import Path

from backend.config import Settings
from backend.jobs import JobRecord
from backend.progress_jobs import ProgressJobManager
from backend.schemas import JobStatus


def build_manager(tmp_path: Path) -> ProgressJobManager:
    settings = Settings(
        job_root=tmp_path / "jobs",
        frontend_dir=tmp_path / "front",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    return ProgressJobManager(settings)


def record(job_id: str, status: JobStatus) -> JobRecord:
    return JobRecord(
        job_id=job_id,
        status=status.value,
        original_name="audio.mp3",
        input_path="audio.mp3",
        content_type="audio/mpeg",
        size_bytes=100,
        created_at=1.0,
    )


def test_measured_progress_never_moves_backwards(tmp_path: Path) -> None:
    manager = build_manager(tmp_path)
    try:
        manager._set_progress("job-1", 64)
        manager._set_progress("job-1", 42)

        response = manager.to_response(
            record("job-1", JobStatus.PROCESSING)
        )

        assert response.progress_percent == 64
    finally:
        manager.shutdown()


def test_completed_job_reports_one_hundred_percent(tmp_path: Path) -> None:
    manager = build_manager(tmp_path)
    try:
        response = manager.to_response(
            record("completed-job", JobStatus.COMPLETED)
        )

        assert response.progress_percent == 100
    finally:
        manager.shutdown()

