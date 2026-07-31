"""API contract tests that do not execute yt-dlp, FFmpeg, or Demucs."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.config import Settings
from backend.jobs import JobRecord
from backend.schemas import JobError, JobStatus, JobStatusResponse


class FakeJobManager:
    """Minimal in-memory manager used to test the HTTP boundary."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.records: dict[str, JobRecord] = {}

    def reserve_upload(
        self, original_name: str, suffix: str, content_type: str | None
    ) -> SimpleNamespace:
        return self._reserve(original_name, suffix, content_type, None)

    def reserve_youtube(self, source_url: str) -> SimpleNamespace:
        return self._reserve(
            "youtube-audio.mp3", ".mp3", "audio/mpeg", source_url
        )

    def _reserve(
        self,
        original_name: str,
        suffix: str,
        content_type: str | None,
        source_url: str | None,
    ) -> SimpleNamespace:
        job_id = str(uuid4())
        job_dir = self.root / job_id
        input_dir = job_dir / "input"
        input_dir.mkdir(parents=True)
        return SimpleNamespace(
            job_id=job_id,
            job_dir=job_dir,
            input_path=input_dir / f"source{suffix}",
            original_name=original_name,
            content_type=content_type,
            source_url=source_url,
        )

    def discard(self, reservation: SimpleNamespace) -> None:
        if reservation.input_path.exists():
            reservation.input_path.unlink()

    def enqueue(
        self, reservation: SimpleNamespace, size_bytes: int = 0
    ) -> JobRecord:
        record = JobRecord(
            job_id=reservation.job_id,
            status=JobStatus.QUEUED.value,
            original_name=reservation.original_name,
            input_path=str(reservation.input_path),
            content_type=reservation.content_type,
            size_bytes=size_bytes,
            created_at=1.0,
            message="Job aceito.",
            source_url=reservation.source_url,
        )
        self.records[record.job_id] = record
        return record

    def get(self, job_id: str) -> JobRecord | None:
        record = self.records.get(job_id)
        return replace(record) if record else None

    def to_response(self, record: JobRecord) -> JobStatusResponse:
        return JobStatusResponse(
            job_id=record.job_id,
            status=JobStatus(record.status),
            message=record.message,
            download_url=(
                f"/api/jobs/{record.job_id}/download"
                if record.status == JobStatus.COMPLETED.value
                else None
            ),
            error=(
                JobError(
                    code=record.error_code or "ERROR",
                    message=record.error_message or "Falha.",
                )
                if record.status == JobStatus.FAILED.value
                else None
            ),
        )

    def output_path(self, record: JobRecord) -> Path | None:
        return Path(record.output_zip) if record.output_zip else None

    def shutdown(self) -> None:
        return None


def build_client(tmp_path: Path, max_bytes: int = 1024) -> tuple[TestClient, FakeJobManager]:
    settings = Settings(
        job_root=tmp_path / "jobs",
        database_path=tmp_path / "test.db",
        frontend_dir=tmp_path / "missing-front",
        max_upload_bytes=max_bytes,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    manager = FakeJobManager(settings.job_root)
    client = TestClient(create_app(settings, manager))
    registered = client.post(
        "/api/auth/register",
        json={
            "name": "Teste MUSICAI",
            "email": "teste@example.com",
            "password": "senha-segura-123",
        },
    )
    assert registered.status_code == 201
    return client, manager


def test_health(tmp_path: Path) -> None:
    client, _ = build_client(tmp_path)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "musicai-api"}


def test_accepts_audio_upload(tmp_path: Path) -> None:
    client, manager = build_client(tmp_path)

    response = client.post(
        "/api/jobs",
        files={"file": ("solo.wav", b"RIFFaudio", "audio/wav")},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "queued"
    record = manager.records[payload["job_id"]]
    assert Path(record.input_path).read_bytes() == b"RIFFaudio"
    assert record.source_url is None


def test_accepts_youtube_url(tmp_path: Path) -> None:
    client, manager = build_client(tmp_path)
    url = "https://www.youtube.com/watch?v=XgzdrVggJ-E"

    response = client.post("/api/jobs", data={"youtube_url": url})

    assert response.status_code == 202
    record = manager.records[response.json()["job_id"]]
    assert record.source_url == url
    assert record.size_bytes == 0


def test_rejects_non_youtube_url(tmp_path: Path) -> None:
    client, _ = build_client(tmp_path)

    response = client.post(
        "/api/jobs", data={"youtube_url": "https://example.com/audio"}
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_YOUTUBE_URL"


def test_requires_exactly_one_source(tmp_path: Path) -> None:
    client, _ = build_client(tmp_path)

    missing = client.post("/api/jobs")
    both = client.post(
        "/api/jobs",
        data={"youtube_url": "https://youtu.be/XgzdrVggJ-E"},
        files={"file": ("solo.mp3", b"audio", "audio/mpeg")},
    )

    assert missing.status_code == 400
    assert both.status_code == 400
    assert (
        both.json()["error"]["code"] == "EXACTLY_ONE_SOURCE_REQUIRED"
    )


def test_rejects_oversized_upload(tmp_path: Path) -> None:
    client, _ = build_client(tmp_path, max_bytes=4)

    response = client.post(
        "/api/jobs",
        files={"file": ("solo.mp3", b"12345", "audio/mpeg")},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_download_only_after_completion(tmp_path: Path) -> None:
    client, manager = build_client(tmp_path)
    created = client.post(
        "/api/jobs",
        files={"file": ("solo.mp3", b"audio", "audio/mpeg")},
    ).json()
    job_id = created["job_id"]

    pending = client.get(f"/api/jobs/{job_id}/download")
    archive = tmp_path / "jobs" / job_id / "result.zip"
    archive.write_bytes(b"PK-demo")
    manager.records[job_id].status = JobStatus.COMPLETED.value
    manager.records[job_id].output_zip = str(archive)
    completed = client.get(f"/api/jobs/{job_id}/download")

    assert pending.status_code == 409
    assert completed.status_code == 200
    assert completed.content == b"PK-demo"

