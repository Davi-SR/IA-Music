"""Regression checks for non-blocking React multitrack playback."""

from __future__ import annotations

from backend.config import PROJECT_ROOT


def _mixer_source() -> str:
    return (
        PROJECT_ROOT
        / "frontend"
        / "src"
        / "features"
        / "library"
        / "Mixer.tsx"
    ).read_text(encoding="utf-8")


def test_player_does_not_wait_for_all_tracks_before_starting() -> None:
    source = _mixer_source()
    play_block = source[source.index("  const play = async") : source.index(
        "  const seek ="
    )]

    assert "await Promise.all" not in play_block
    assert play_block.index("setPlaying(true)") < play_block.index(
        "await audio.play()"
    )
    assert "void Promise.all(attempts)" in play_block
    assert "started === 0" in play_block


def test_player_uses_an_actively_playing_track_as_clock() -> None:
    source = _mixer_source()

    assert "const active = values.find" in source
    assert "HTMLMediaElement.HAVE_CURRENT_DATA" in source
    assert "requestAnimationFrame(tick)" in source
