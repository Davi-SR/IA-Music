"""Regression checks for non-blocking multitrack playback."""

from __future__ import annotations

from backend.config import PROJECT_ROOT


def test_player_does_not_wait_for_all_tracks_before_starting() -> None:
    source = (
        PROJECT_ROOT
        / "Front"
        / "glass-effect2"
        / "library-v3.js"
    ).read_text(encoding="utf-8")
    play_block = source[source.index("  play() {") : source.index("  pause() {")]

    assert "Promise.allSettled" not in play_block
    assert play_block.index("this.playing = true") < play_block.index(
        "track.audio.play()"
    )
    assert "startedTracks === 0" in play_block


def test_player_uses_an_actively_playing_track_as_clock() -> None:
    source = (
        PROJECT_ROOT
        / "Front"
        / "glass-effect2"
        / "library-v3.js"
    ).read_text(encoding="utf-8")

    assert "const activeTrack = this.tracks.find" in source
    assert "HTMLMediaElement.HAVE_CURRENT_DATA" in source
    assert "this.updatePlayButton();" in source

