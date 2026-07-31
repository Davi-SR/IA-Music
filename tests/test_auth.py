"""Authentication, session, reset-token, and ownership security tests."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.auth import AuthService
from backend.config import Settings
from backend.jobs import JobManager


def build_auth_client(
    tmp_path: Path,
) -> tuple[TestClient, JobManager, AuthService]:
    settings = Settings(
        job_root=tmp_path / "jobs",
        database_path=tmp_path / "musicai-test.db",
        frontend_dir=tmp_path / "missing-front",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
        google_client_id=None,
        google_client_secret=None,
        google_redirect_uri=None,
    )
    manager = JobManager(settings)
    service = AuthService(settings)
    return TestClient(create_app(settings, manager, service)), manager, service


def register(client: TestClient, email: str = "davi@example.com"):
    return client.post(
        "/api/auth/register",
        json={
            "name": "Davi Ramos",
            "email": email,
            "password": "guitarra-segura-123",
        },
    )


def test_register_session_profile_and_logout(tmp_path: Path) -> None:
    client, manager, _ = build_auth_client(tmp_path)
    try:
        response = register(client)

        assert response.status_code == 201
        assert response.json()["user"]["email"] == "davi@example.com"
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert client.get("/api/auth/me").status_code == 200

        updated = client.patch(
            "/api/auth/me", json={"name": "Davi MUSICAI"}
        )
        assert updated.json()["user"]["name"] == "Davi MUSICAI"

        logout = client.post("/api/auth/logout")
        assert logout.status_code == 204
        assert client.get("/api/auth/me").status_code == 401
    finally:
        manager.shutdown()


def test_duplicate_login_and_password_reset(tmp_path: Path) -> None:
    client, manager, service = build_auth_client(tmp_path)
    try:
        assert register(client).status_code == 201
        assert register(client).status_code == 409
        client.post("/api/auth/logout")

        invalid = client.post(
            "/api/auth/login",
            json={"email": "davi@example.com", "password": "senha-errada"},
        )
        assert invalid.status_code == 401

        token = service.create_password_reset("davi@example.com")
        assert token is not None
        reset = client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "nova-senha-segura-456"},
        )
        assert reset.status_code == 204
        assert client.post(
            "/api/auth/login",
            json={
                "email": "davi@example.com",
                "password": "nova-senha-segura-456",
            },
        ).status_code == 200
        assert client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "outra-senha-segura-789"},
        ).status_code == 400
    finally:
        manager.shutdown()


def test_jobs_are_owned_by_exactly_one_user(tmp_path: Path) -> None:
    client, manager, service = build_auth_client(tmp_path)
    try:
        first = register(client).json()["user"]
        client.post("/api/auth/logout")
        second = register(client, "outra@example.com").json()["user"]
        job_id = "11111111-1111-4111-8111-111111111111"

        service.claim_job(job_id, first["id"])
        assert service.owns_job(job_id, first["id"])
        assert not service.owns_job(job_id, second["id"])
        assert job_id not in service.owned_job_ids(second["id"])
    finally:
        manager.shutdown()


def test_google_requires_server_credentials(tmp_path: Path) -> None:
    client, manager, _ = build_auth_client(tmp_path)
    try:
        response = client.get(
            "/api/auth/google/start", follow_redirects=False
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "GOOGLE_AUTH_NOT_CONFIGURED"
    finally:
        manager.shutdown()


def test_google_profile_picture_is_persisted(tmp_path: Path) -> None:
    client, manager, service = build_auth_client(tmp_path)
    try:
        user, _ = service.upsert_google_user(
            "google-sub-123",
            "google@example.com",
            "Google User",
            "https://lh3.googleusercontent.com/a/profile-photo",
        )

        assert user.google_connected is True
        assert user.avatar_url == "https://lh3.googleusercontent.com/a/profile-photo"
        assert client.cookies.get("musicai_session") is None
    finally:
        manager.shutdown()