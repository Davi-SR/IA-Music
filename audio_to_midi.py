"""Stage 3: transcribe an isolated guitar track to MIDI with Basic Pitch."""

from __future__ import annotations

import logging
from pathlib import Path


LOGGER = logging.getLogger(__name__)
DEFAULT_MIDI_DIR = Path("data/midi")


class AudioToMidiError(RuntimeError):
    """Raised when Basic Pitch cannot generate the expected MIDI output."""


def _is_valid_output(path: Path) -> bool:
    """Return whether an output file exists and contains data."""
    return path.is_file() and path.stat().st_size > 0


def audio_to_midi(
    guitar_audio_path: Path,
    midi_dir: Path = DEFAULT_MIDI_DIR,
) -> Path:
    """Convert an isolated guitar audio file to MIDI with Basic Pitch.

    Demucs names every isolated guitar stem ``guitar.wav``. To prevent MIDI
    files from different source tracks from colliding, each result is stored
    below a source-specific subdirectory, such as
    ``data/midi/<video_id>/guitar_basic_pitch.mid``.

    The operation is idempotent: an existing non-empty MIDI file is returned
    without running model inference again.

    Args:
        guitar_audio_path: Path to the isolated guitar audio file.
        midi_dir: Root directory for generated MIDI files.

    Returns:
        Path to the generated MIDI file.

    Raises:
        FileNotFoundError: If the guitar audio file does not exist.
        AudioToMidiError: If Basic Pitch is unavailable or inference fails.
    """
    guitar_audio_path = Path(guitar_audio_path)
    midi_dir = Path(midi_dir)

    if not guitar_audio_path.is_file():
        raise FileNotFoundError(
            f"Isolated guitar audio does not exist: {guitar_audio_path}"
        )
    if guitar_audio_path.stat().st_size == 0:
        raise AudioToMidiError(
            f"Isolated guitar audio is empty: {guitar_audio_path}"
        )

    source_name = guitar_audio_path.parent.name or guitar_audio_path.stem
    track_midi_dir = midi_dir / source_name
    midi_path = (
        track_midi_dir / f"{guitar_audio_path.stem}_basic_pitch.mid"
    )

    if _is_valid_output(midi_path):
        LOGGER.info(
            "Audio-to-MIDI conversion already complete; reusing %s",
            midi_path,
        )
        return midi_path

    track_midi_dir.mkdir(parents=True, exist_ok=True)

    # Basic Pitch refuses to overwrite an existing output. A zero-byte file is
    # an incomplete pipeline artifact and is safe to replace.
    if midi_path.exists():
        LOGGER.warning("Removing incomplete MIDI output: %s", midi_path)
        midi_path.unlink()

    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import predict_and_save
    except ImportError as exc:
        raise AudioToMidiError(
            "Basic Pitch is not installed correctly. Install the "
            "'basic-pitch' package and synchronize its dependencies."
        ) from exc
    except Exception as exc:
        raise AudioToMidiError(
            "Could not initialize Basic Pitch."
        ) from exc

    LOGGER.info("Converting guitar audio to MIDI with Basic Pitch")
    try:
        predict_and_save(
            audio_path_list=[guitar_audio_path],
            output_directory=track_midi_dir,
            save_midi=True,
            sonify_midi=False,
            save_model_outputs=False,
            save_notes=False,
            model_or_model_path=ICASSP_2022_MODEL_PATH,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        raise AudioToMidiError(
            f"Basic Pitch audio-to-MIDI conversion failed: {exc}"
        ) from exc
    except Exception as exc:
        raise AudioToMidiError(
            "Unexpected error during Basic Pitch inference."
        ) from exc

    if not _is_valid_output(midi_path):
        raise AudioToMidiError(
            "Basic Pitch completed without creating the expected MIDI file: "
            f"{midi_path}"
        )

    LOGGER.info("MIDI generated successfully at %s", midi_path)
    return midi_path
