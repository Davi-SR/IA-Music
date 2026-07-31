from __future__ import annotations

import sqlite3
from pathlib import Path

from backend.auth import AuthService
from backend.config import Settings


def test_existing_database_is_migrated_and_google_avatar_is_saved(
    tmp_path: Path,
) -> None:
    database = tmp_path / "legacy.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                password_hash TEXT,
                google_sub TEXT UNIQUE,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )

    service = AuthService(
        Settings(
            database_path=database,
            job_root=tmp_path / "jobs",
            frontend_dir=tmp_path / "frontend",
        )
    )
    user, first = service.upsert_google_user(
        "google-user-1",
        "guitar@example.com",
        "Guitar Player",
        "https://lh3.googleusercontent.com/profile-photo",
    )

    assert first is True
    assert user.avatar_url == "https://lh3.googleusercontent.com/profile-photo"
    with sqlite3.connect(database) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
    assert "avatar_url" in columns


def test_google_avatar_rejects_non_https_urls(tmp_path: Path) -> None:
    service = AuthService(
        Settings(
            database_path=tmp_path / "musicai.db",
            job_root=tmp_path / "jobs",
            frontend_dir=tmp_path / "frontend",
        )
    )
    user, _ = service.upsert_google_user(
        "google-user-2",
        "player@example.com",
        "Player",
        "http://untrusted.example/avatar.png",
    )

    assert user.avatar_url is None
