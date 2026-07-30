"""Completed library, stem streaming, and download contract tests."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.application import create_app
from backend.config import Settings
from backend.jobs import DEMUCS_MODEL, STEMS, JobRecord
from backend.library import LibraryJobManager
from backend.schemas import JobStatus


def build_library(tmp_path: Path) -> tuple[TestClient, LibraryJobManager, str]:
    settings = Settings(
        job_root=tmp_path / "jobs",
        frontend_dir=tmp_path / "missing-front",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    manager = LibraryJobManager(settings)
    job_id = "11111111-1111-4111-8111-111111111111"
    job_dir = settings.job_root / job_id
    input_path = job_dir / "input" / "source.mp3"
    input_path.parent.mkdir(parents=True)
    input_path.write_bytes(b"audio")
    stem_dir = job_dir / "separated" / DEMUCS_MODEL / "source"
    stem_dir.mkdir(parents=True)
    for stem in STEMS:
        (stem_dir / f"{stem}.wav").write_bytes(b"RIFF" + stem.encode())
    archive = job_dir / "result" / "music_stems.zip"
    archive.parent.mkdir()
    archive.write_bytes(b"PK-result")

    record = JobRecord(
        job_id=job_id,
        status=JobStatus.COMPLETED.value,
        original_name="Minha Música.mp3",
        input_path=str(input_path),
        content_type="audio/mpeg",
        size_bytes=5,
        created_at=time.time() - 100,
        started_at=time.time() - 90,
        finished_at=time.time(),
        message="Pronto.",
        output_zip=str(archive),
        source_url="https://youtu.be/example",
    )
    with manager._lock:
        manager._records[job_id] = record
        manager._persist(record)
    return TestClient(create_app(settings, manager)), manager, job_id


def test_library_lists_completed_music_with_six_stems(
    tmp_path: Path,
) -> None:
    client, manager, job_id = build_library(tmp_path)
    try:
        response = client.get("/api/library")

        assert response.status_code == 200
        [item] = response.json()["items"]
        assert item["job_id"] == job_id
        assert item["title"] == "Minha Música"
        assert item["source_type"] == "youtube"
        assert [stem["id"] for stem in item["stems"]] == list(STEMS)
    finally:
        manager.shutdown()


def test_stem_can_be_streamed_and_downloaded(tmp_path: Path) -> None:
    client, manager, job_id = build_library(tmp_path)
    try:
        stream = client.get(f"/api/jobs/{job_id}/stems/guitar")
        download = client.get(
            f"/api/jobs/{job_id}/stems/guitar/download"
        )

        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("audio/wav")
        assert stream.content == b"RIFFguitar"
        assert download.status_code == 200
        assert "attachment" in download.headers["content-disposition"]
        assert download.content == b"RIFFguitar"
    finally:
        manager.shutdown()


def test_unknown_stem_is_rejected(tmp_path: Path) -> None:
    client, manager, job_id = build_library(tmp_path)
    try:
        response = client.get(f"/api/jobs/{job_id}/stems/secrets")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "STEM_NOT_FOUND"
    finally:
        manager.shutdown()

