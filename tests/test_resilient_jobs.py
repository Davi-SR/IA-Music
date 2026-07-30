"""Tests for metadata persistence under transient Windows file locks."""

from __future__ import annotations

import json
from pathlib import Path

from backend.config import Settings
from backend.jobs import JobRecord
from backend.resilient_jobs import ResilientProgressJobManager
from backend.schemas import JobStatus


def build_manager(tmp_path: Path) -> ResilientProgressJobManager:
    settings = Settings(
        job_root=tmp_path / "jobs",
        frontend_dir=tmp_path / "front",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    return ResilientProgressJobManager(settings)


def test_persistence_retries_transient_access_denied(
    tmp_path: Path,
    monkeypatch,
) -> None:
    manager = build_manager(tmp_path)
    job = JobRecord(
        job_id="retry-job",
        status=JobStatus.QUEUED.value,
        original_name="audio.mp3",
        input_path="audio.mp3",
        content_type="audio/mpeg",
        size_bytes=10,
        created_at=1.0,
    )
    from backend import resilient_jobs

    real_replace = resilient_jobs.os.replace
    calls = 0

    def flaky_replace(source, destination) -> None:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise PermissionError(5, "Access denied")
        real_replace(source, destination)

    monkeypatch.setattr(resilient_jobs.os, "replace", flaky_replace)
    monkeypatch.setattr(resilient_jobs.time, "sleep", lambda _: None)
    try:
        manager._persist(job)
        payload = json.loads(
            (tmp_path / "jobs" / "retry-job" / "job.json").read_text(
                encoding="utf-8"
            )
        )
        assert calls == 3
        assert payload["job_id"] == "retry-job"
    finally:
        manager.shutdown()


def test_persistence_failure_does_not_fail_processing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    manager = build_manager(tmp_path)
    job = JobRecord(
        job_id="locked-job",
        status=JobStatus.PROCESSING.value,
        original_name="audio.mp3",
        input_path="audio.mp3",
        content_type="audio/mpeg",
        size_bytes=10,
        created_at=1.0,
    )
    from backend import resilient_jobs

    monkeypatch.setattr(
        resilient_jobs.os,
        "replace",
        lambda *_: (_ for _ in ()).throw(PermissionError(5, "Access denied")),
    )
    monkeypatch.setattr(resilient_jobs.time, "sleep", lambda _: None)
    try:
        manager._persist(job)
    finally:
        manager.shutdown()

