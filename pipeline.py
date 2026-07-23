"""Orchestrate the YouTube-to-guitar-MIDI pipeline.

Pipeline stages:
    1. Download the best YouTube audio and convert it to MP3.
    2. Isolate the guitar stem with Demucs' six-stem model.
    3. Transcribe the isolated guitar audio to MIDI with Basic Pitch.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Sequence

from audio_preprocessing import (
    DEFAULT_PROCESSED_DIR,
    DEFAULT_RAW_DIR,
    PipelineError,
    extract_audio,
    isolate_guitar,
)
from audio_to_midi import (
    DEFAULT_MIDI_DIR,
    AudioToMidiError,
    audio_to_midi,
)


LOGGER = logging.getLogger(__name__)


def run_pipeline(
    youtube_url: str,
    raw_dir: Path = DEFAULT_RAW_DIR,
    processed_dir: Path = DEFAULT_PROCESSED_DIR,
    midi_dir: Path = DEFAULT_MIDI_DIR,
) -> Path:
    """Run extraction, guitar source separation, and MIDI transcription.

    Args:
        youtube_url: URL of the YouTube video to process.
        raw_dir: Directory for downloaded MP3 files.
        processed_dir: Root directory for separated stems.
        midi_dir: Root directory for generated MIDI files.

    Returns:
        Path to the generated MIDI file.
    """
    LOGGER.info("Starting guitar transcription pipeline")
    audio_path = extract_audio(youtube_url, raw_dir)
    guitar_path = isolate_guitar(audio_path, processed_dir)
    midi_path = audio_to_midi(guitar_path, midi_dir)
    LOGGER.info("Pipeline completed successfully")
    return midi_path


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description=(
            "Download YouTube audio, isolate its guitar stem, and generate MIDI."
        ),
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
        "--midi-dir",
        type=Path,
        default=DEFAULT_MIDI_DIR,
        help="Directory for Basic Pitch output (default: data/midi)",
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
        midi_path = run_pipeline(
            youtube_url=args.youtube_url,
            raw_dir=args.raw_dir,
            processed_dir=args.processed_dir,
            midi_dir=args.midi_dir,
        )
    except (
        AudioToMidiError,
        FileNotFoundError,
        PipelineError,
        ValueError,
    ) as exc:
        LOGGER.error("Pipeline failed: %s", exc)
        return 1

    LOGGER.info("Final MIDI file: %s", midi_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
