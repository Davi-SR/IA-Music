"""Static page separation checks for Home and Minhas Músicas."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.application import create_app
from backend.config import PROJECT_ROOT, Settings
from backend.library import LibraryJobManager


def build_client(tmp_path: Path) -> tuple[TestClient, LibraryJobManager]:
    settings = Settings(
        job_root=tmp_path / "jobs",
        frontend_dir=PROJECT_ROOT / "Front" / "glass-effect2",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        process_timeout_seconds=60,
        demucs_executable="demucs",
        cors_origins=(),
    )
    manager = LibraryJobManager(settings)
    return TestClient(create_app(settings, manager)), manager


def test_home_and_music_library_are_separate_pages(tmp_path: Path) -> None:
    client, manager = build_client(tmp_path)
    try:
        home = client.get("/")
        musics = client.get("/musics.html")

        assert home.status_code == 200
        assert musics.status_code == 200
        assert 'data-page="musics"' not in home.text
        assert 'data-page="musics"' in musics.text
        assert 'href="musics.html"' in musics.text
        assert "active" in musics.text
        assert 'aria-current="page"' in musics.text
    finally:
        manager.shutdown()


def test_runtime_preloads_only_the_current_page_assets(
    tmp_path: Path,
) -> None:
    client, manager = build_client(tmp_path)
    try:
        config = client.get("/config.js").text

        assert "isMusicsPage" in config
        assert 'preloadModule("library-v3.js?v=5"' in config
        assert 'preloadModule("youtube-v2.js?v=5"' in config
        assert 'loadModule("library-v3.js?v=5"' in config
        assert 'loadModule("youtube-v2.js?v=5"' in config
        assert 'renderPrimaryNavigation("musics")' in config
        assert "home-booting" in config
    finally:
        manager.shutdown()

