"""Extract YouTube audio and isolate its guitar stem with Demucs.

Pipeline stages:
    1. Extract the best available audio from YouTube and convert it to MP3.
    2. Run Demucs' six-stem model and return the isolated guitar track.
"""

from __future__ import annotations

import argparse
import logging
import subprocess
from pathlib import Path
from typing import Any, Sequence
import yt_dlp


LOGGER = logging.getLogger(__name__)
DEFAULT_RAW_DIR = Path("data/raw")
DEFAULT_PROCESSED_DIR = Path("data/processed")
DEMUCS_MODEL = "htdemucs_6s"


class PipelineError(RuntimeError):
    """Raised when an extraction or transformation stage cannot be completed."""


class YtDlpLogger:
    """Route yt-dlp messages through the standard logging module."""

    def debug(self, message: str) -> None:
        """Log yt-dlp diagnostic output."""
        if message.startswith("[debug] "):
            LOGGER.debug(message)
        else:
            LOGGER.info(message)

    def warning(self, message: str) -> None:
        """Log a warning emitted by yt-dlp."""
        LOGGER.warning(message)

    def error(self, message: str) -> None:
        """Log an error emitted by yt-dlp."""
        LOGGER.error(message)


def _is_valid_output(path: Path) -> bool:
    """Return whether a pipeline output exists and contains data."""
    return path.is_file() and path.stat().st_size > 0


def _get_video_info(youtube_url: str) -> dict[str, Any]:
    """Fetch the metadata needed to build a deterministic output filename."""
    metadata_options: dict[str, Any] = {
        "logger": YtDlpLogger(),
        "noplaylist": True,
        "quiet": True,
        "skip_download": True,
    }

    try:
        with yt_dlp.YoutubeDL(metadata_options) as downloader:
            info = downloader.extract_info(youtube_url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise PipelineError(
            f"Could not retrieve metadata for URL: {youtube_url}"
        ) from exc
    except Exception as exc:
        raise PipelineError(
            f"Unexpected error while retrieving metadata for URL: {youtube_url}"
        ) from exc

    if not isinstance(info, dict) or not info.get("id"):
        raise PipelineError("yt-dlp returned metadata without a video ID.")

    return info


def extract_audio(
    youtube_url: str,
    raw_dir: Path = DEFAULT_RAW_DIR,
) -> Path:
    """Download a YouTube video's best audio and convert it to MP3.

    The output name is based on the YouTube video ID, making the operation
    idempotent. An existing non-empty MP3 is returned without being downloaded
    again.

    Args:
        youtube_url: URL of the YouTube video to download.
        raw_dir: Directory where the MP3 file will be stored.

    Returns:
        Path to the downloaded MP3 file.

    Raises:
        ValueError: If ``youtube_url`` is empty.
        PipelineError: If metadata retrieval, download, or conversion fails.
    """
    if not youtube_url.strip():
        raise ValueError("youtube_url must not be empty.")

    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)

    info = _get_video_info(youtube_url)
    video_id = str(info["id"])
    output_path = raw_dir / f"{video_id}.mp3"

    if _is_valid_output(output_path):
        LOGGER.info("Extraction already complete; reusing %s", output_path)
        return output_path

    download_options: dict[str, Any] = {
        "format": "bestaudio/best",
        "logger": YtDlpLogger(),
        "noplaylist": True,
        "outtmpl": str(raw_dir / "%(id)s.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",
            }
        ],
        "quiet": True,
    }

    LOGGER.info("Downloading audio from %s", youtube_url)
    try:
        with yt_dlp.YoutubeDL(download_options) as downloader:
            downloader.download([youtube_url])
    except yt_dlp.utils.DownloadError as exc:
        raise PipelineError(
            "Audio download or FFmpeg MP3 conversion failed."
        ) from exc
    except Exception as exc:
        raise PipelineError(
            "Unexpected error during audio extraction."
        ) from exc

    if not _is_valid_output(output_path):
        raise PipelineError(
            f"yt-dlp completed without creating the expected file: {output_path}"
        )

    LOGGER.info("Audio extracted successfully to %s", output_path)
    return output_path


def isolate_guitar(
    audio_path: Path,
    processed_dir: Path = DEFAULT_PROCESSED_DIR,
) -> Path:
    """Isolate the guitar stem from an audio file with Demucs.

    Demucs is executed through its CLI using the mandatory six-stem
    ``htdemucs_6s`` model. The operation is idempotent: a non-empty existing
    guitar stem is reused.

    Args:
        audio_path: Audio file to process.
        processed_dir: Root directory for Demucs output.

    Returns:
        Path to the isolated ``guitar.wav`` stem.

    Raises:
        FileNotFoundError: If the input audio does not exist.
        PipelineError: If Demucs is unavailable or source separation fails.
    """
    audio_path = Path(audio_path)
    processed_dir = Path(processed_dir)

    if not audio_path.is_file():
        raise FileNotFoundError(f"Input audio file does not exist: {audio_path}")

    processed_dir.mkdir(parents=True, exist_ok=True)
    guitar_path = (
        processed_dir / DEMUCS_MODEL / audio_path.stem / "guitar.wav"
    )

    if _is_valid_output(guitar_path):
        LOGGER.info(
            "Guitar isolation already complete; reusing %s",
            guitar_path,
        )
        return guitar_path

    command = [
        "demucs",
        "-n",
        DEMUCS_MODEL,
        "--out",
        str(processed_dir),
        str(audio_path),
    ]

    LOGGER.info("Running source separation with model %s", DEMUCS_MODEL)
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise PipelineError(
            "The 'demucs' executable was not found. Install Demucs and ensure "
            "its executable is available on PATH."
        ) from exc
    except subprocess.CalledProcessError as exc:
        error_output = (exc.stderr or exc.stdout or "No CLI output").strip()
        raise PipelineError(
            f"Demucs source separation failed: {error_output}"
        ) from exc
    except OSError as exc:
        raise PipelineError("Could not start the Demucs process.") from exc

    if result.stdout:
        LOGGER.debug("Demucs stdout:\n%s", result.stdout.strip())
    if result.stderr:
        LOGGER.debug("Demucs stderr:\n%s", result.stderr.strip())

    if not _is_valid_output(guitar_path):
        raise PipelineError(
            f"Demucs completed without creating the expected stem: {guitar_path}"
        )

    LOGGER.info("Guitar stem isolated successfully to %s", guitar_path)
    return guitar_path


def run_pipeline(
    youtube_url: str,
    raw_dir: Path = DEFAULT_RAW_DIR,
    processed_dir: Path = DEFAULT_PROCESSED_DIR,
) -> Path:
    """Run audio extraction followed by guitar source separation.

    Args:
        youtube_url: URL of the YouTube video to process.
        raw_dir: Directory for downloaded MP3 files.
        processed_dir: Root directory for separated stems.

    Returns:
        Path to the isolated guitar WAV file.
    """
    LOGGER.info("Starting guitar transcription preprocessing pipeline")
    audio_path = extract_audio(youtube_url, raw_dir)
    guitar_path = isolate_guitar(audio_path, processed_dir)
    LOGGER.info("Pipeline completed successfully")
    return guitar_path


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Download YouTube audio and isolate its guitar stem.",
    )
    parser.add_argument("youtube_url", help="YouTube video URL")
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=DEFAULT_RAW_DIR,
        help="Directory for downloaded MP3 files (default: data/raw)",
    )
    parser.add_argument(
        "--processed-dir",
        type=Path,
        default=DEFAULT_PROCESSED_DIR,
        help="Directory for Demucs output (default: data/processed)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command-line entry point and return its process exit code."""
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    try:
        guitar_path = run_pipeline(
            youtube_url=args.youtube_url,
            raw_dir=args.raw_dir,
            processed_dir=args.processed_dir,
        )
    except (PipelineError, FileNotFoundError, ValueError) as exc:
        LOGGER.error("Pipeline failed: %s", exc)
        return 1

    LOGGER.info("Final guitar stem: %s", guitar_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
