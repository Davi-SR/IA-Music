"""Application configuration loaded from environment variables."""

from __future__ import annotations

import logging
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path


LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_environment_file(path: Path | None = None) -> None:
    """Load a local .env without overwriting process environment variables."""
    env_path = path or PROJECT_ROOT / ".env"
    if not env_path.is_file():
        return

    loaded = 0
    for line_number, source_line in enumerate(
        env_path.read_text(encoding="utf-8-sig").splitlines(), start=1
    ):
        line = source_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, raw_value = line.partition("=")
        key = key.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            LOGGER.warning("Ignoring invalid .env entry at line %d.", line_number)
            continue
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        if key not in os.environ:
            os.environ[key] = value
            loaded += 1
    LOGGER.info("Loaded %d setting(s) from %s.", loaded, env_path)


load_environment_file()


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


def _bounded_positive_int(name: str, default: int, maximum: int) -> int:
    value = _positive_int(name, default)
    if value > maximum:
        LOGGER.warning(
            "%s=%s is above the maximum %s; using %s.",
            name,
            value,
            maximum,
            maximum,
        )
        return maximum
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
    """Runtime settings for uploads, workers, storage, auth, and the front-end."""

    job_root: Path = field(
        default_factory=lambda: Path(
            os.getenv("AUDIO_JOB_ROOT", PROJECT_ROOT / "data" / "jobs")
        )
    )
    database_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("MUSICAI_DATABASE_PATH", PROJECT_ROOT / "data" / "musicai.db")
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
        default_factory=lambda: _positive_int("AUDIO_MAX_CONCURRENT_JOBS", 1)
    )
    process_timeout_seconds: int = field(
        default_factory=lambda: _positive_int(
            "AUDIO_PROCESS_TIMEOUT_SECONDS", 2 * 60 * 60
        )
    )
    demucs_executable: str = field(
        default_factory=lambda: os.getenv("AUDIO_DEMUCS_EXECUTABLE", "demucs")
    )
    demucs_device: str = field(
        default_factory=lambda: os.getenv("AUDIO_DEMUCS_DEVICE", "cpu")
    )
    demucs_segment_seconds: int = field(
        default_factory=lambda: _bounded_positive_int(
            "AUDIO_DEMUCS_SEGMENT_SECONDS", 7, 7
        )
    )
    demucs_shifts: int = field(
        default_factory=lambda: int(os.getenv("AUDIO_DEMUCS_SHIFTS", "0"))
    )
    demucs_jobs: int = field(
        default_factory=lambda: _positive_int("AUDIO_DEMUCS_JOBS", 1)
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in os.getenv("AUDIO_CORS_ORIGINS", "").split(",")
            if origin.strip()
        )
    )
    public_base_url: str = field(
        default_factory=lambda: os.getenv(
            "MUSICAI_PUBLIC_BASE_URL", "http://127.0.0.1:8000"
        )
    )
    session_ttl_seconds: int = field(
        default_factory=lambda: _positive_int(
            "MUSICAI_SESSION_TTL_SECONDS", 30 * 24 * 60 * 60
        )
    )
    password_reset_ttl_seconds: int = field(
        default_factory=lambda: _positive_int(
            "MUSICAI_PASSWORD_RESET_TTL_SECONDS", 60 * 60
        )
    )
    secure_cookies: bool = field(
        default_factory=lambda: os.getenv("MUSICAI_SECURE_COOKIES", "false").lower()
        in {"1", "true", "yes"}
    )
    cookie_samesite: str = field(
        default_factory=lambda: os.getenv("MUSICAI_COOKIE_SAMESITE", "lax").lower()
        if os.getenv("MUSICAI_COOKIE_SAMESITE", "lax").lower() in {"lax", "strict", "none"}
        else "lax"
    )
    google_client_id: str | None = field(
        default_factory=lambda: os.getenv("GOOGLE_CLIENT_ID")
    )
    google_client_secret: str | None = field(
        default_factory=lambda: os.getenv("GOOGLE_CLIENT_SECRET")
    )
    google_redirect_uri: str | None = field(
        default_factory=lambda: os.getenv("GOOGLE_REDIRECT_URI")
    )
    smtp_host: str | None = field(
        default_factory=lambda: os.getenv("MUSICAI_SMTP_HOST")
    )
    smtp_port: int = field(
        default_factory=lambda: _positive_int("MUSICAI_SMTP_PORT", 587)
    )
    smtp_username: str | None = field(
        default_factory=lambda: os.getenv("MUSICAI_SMTP_USERNAME")
    )
    smtp_password: str | None = field(
        default_factory=lambda: os.getenv("MUSICAI_SMTP_PASSWORD")
    )
    smtp_sender: str | None = field(
        default_factory=lambda: os.getenv("MUSICAI_SMTP_SENDER")
    )
    smtp_starttls: bool = field(
        default_factory=lambda: os.getenv("MUSICAI_SMTP_STARTTLS", "true").lower()
        in {"1", "true", "yes"}
    )
    ffmpeg_directory: Path | None = field(
        default_factory=ensure_ffmpeg_on_path
    )
    youtube_cookie_file: Path | None = field(
        default_factory=lambda: (
            Path(raw_path).expanduser()
            if (raw_path := os.getenv("AUDIO_YOUTUBE_COOKIE_FILE"))
            else None
        )
    )
