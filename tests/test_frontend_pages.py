"""Static page separation checks for the React production build."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from backend.application import create_app
from backend.config import PROJECT_ROOT, Settings
from backend.library import LibraryJobManager


def build_client(tmp_path: Path) -> tuple[TestClient, LibraryJobManager]:
    settings = Settings(
        job_root=tmp_path / "jobs",
        database_path=tmp_path / "test.db",
        frontend_dir=PROJECT_ROOT / "Front" / "glass-effect2",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    manager = LibraryJobManager(settings)
    return TestClient(create_app(settings, manager)), manager


def _entry_script(html: str) -> str:
    match = re.search(r'src="(\./react-assets/[^"]+\.js)"', html)
    assert match is not None
    return match.group(1)


def test_home_and_music_library_are_separate_pages(tmp_path: Path) -> None:
    client, manager = build_client(tmp_path)
    try:
        home = client.get("/")
        musics = client.get("/musics.html")

        assert home.status_code == 200
        assert musics.status_code == 200
        assert 'data-page="musics"' not in home.text
        assert 'data-page="musics"' in musics.text
        assert _entry_script(home.text) != _entry_script(musics.text)
        assert '<div id="root"></div>' in home.text
        assert '<div id="root"></div>' in musics.text
    finally:
        manager.shutdown()


def test_production_entries_use_react_chunks_without_legacy_runtimes(
    tmp_path: Path,
) -> None:
    client, manager = build_client(tmp_path)
    try:
        home = client.get("/").text
        musics = client.get("/musics.html").text
        shared_assets = home + musics

        assert "react-assets/" in shared_assets
        assert "config.js" not in shared_assets
        assert "app.js" not in shared_assets
        assert "youtube-v2.js" not in shared_assets
        assert "library-v3.js" not in shared_assets
    finally:
        manager.shutdown()
