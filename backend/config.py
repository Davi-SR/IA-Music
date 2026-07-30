"""Application configuration loaded from environment variables."""

from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path


LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _positive_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer.") from exc
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    return value


def _valid_ffmpeg_directory(path: Path) -> Path | None:
    """Return a directory only when both required binaries exist."""
    directory = path.parent if path.is_file() else path
    executable_suffix = ".exe" if os.name == "nt" else ""
    ffmpeg = directory / f"ffmpeg{executable_suffix}"
    ffprobe = directory / f"ffprobe{executable_suffix}"
    return directory if ffmpeg.is_file() and ffprobe.is_file() else None


def discover_ffmpeg_directory() -> Path | None:
    """Locate FFmpeg from configuration, PATH, or Windows Winget packages."""
    configured = os.getenv("AUDIO_FFMPEG_LOCATION")
    if configured:
        directory = _valid_ffmpeg_directory(Path(configured).expanduser())
        if directory is None:
            raise ValueError(
                "AUDIO_FFMPEG_LOCATION must contain ffmpeg and ffprobe."
            )
        return directory

    executable = shutil.which("ffmpeg")
    if executable:
        directory = _valid_ffmpeg_directory(Path(executable))
        if directory:
            return directory

    if os.name != "nt":
        return None

    local_app_data = os.getenv("LOCALAPPDATA")
    if not local_app_data:
        return None
    packages = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
    if not packages.is_dir():
        return None

    candidates = sorted(
        packages.glob("Gyan.FFmpeg*/*/bin/ffmpeg.exe"),
        reverse=True,
    )
    for candidate in candidates:
        directory = _valid_ffmpeg_directory(candidate)
        if directory:
            return directory
    return None


def ensure_ffmpeg_on_path() -> Path | None:
    """Make discovered FFmpeg available to yt-dlp and child processes."""
    directory = discover_ffmpeg_directory()
    if directory is None:
        LOGGER.warning(
            "FFmpeg was not found. Configure AUDIO_FFMPEG_LOCATION or add "
            "FFmpeg to PATH."
        )
        return None

    current_entries = os.environ.get("PATH", "").split(os.pathsep)
    normalized_entries = {
        os.path.normcase(os.path.abspath(entry))
        for entry in current_entries
        if entry
    }
    normalized_directory = os.path.normcase(os.path.abspath(str(directory)))
    if normalized_directory not in normalized_entries:
        os.environ["PATH"] = (
            f"{directory}{os.pathsep}{os.environ.get('PATH', '')}"
        )
        LOGGER.info("FFmpeg discovered at %s", directory)
    return directory


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings for uploads, workers, storage, and the front-end."""

    job_root: Path = field(
        default_factory=lambda: Path(
            os.getenv("AUDIO_JOB_ROOT", PROJECT_ROOT / "data" / "jobs")
        )
    )
    frontend_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "AUDIO_FRONTEND_DIR",
                PROJECT_ROOT / "Front" / "glass-effect2",
            )
        )
    )
    max_upload_bytes: int = field(
        default_factory=lambda: _positive_int(
            "AUDIO_MAX_UPLOAD_BYTES", 500 * 1024 * 1024
        )
    )
    max_concurrent_jobs: int = field(
        default_factory=lambda: _positive_int(
            "AUDIO_MAX_CONCURRENT_JOBS", 1
        )
    )
    process_timeout_seconds: int = field(
        default_factory=lambda: _positive_int(
            "AUDIO_PROCESS_TIMEOUT_SECONDS", 2 * 60 * 60
        )
    )
    demucs_executable: str = field(
        default_factory=lambda: os.getenv("AUDIO_DEMUCS_EXECUTABLE", "demucs")
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in os.getenv("AUDIO_CORS_ORIGINS", "").split(",")
            if origin.strip()
        )
    )
    ffmpeg_directory: Path | None = field(
        default_factory=ensure_ffmpeg_on_path
    )

