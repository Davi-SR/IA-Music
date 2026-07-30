"""Ensure component cursor declarations cannot reveal the native pointer."""

from __future__ import annotations

from backend.config import PROJECT_ROOT


def test_interactive_components_force_custom_cursor_on_mouse() -> None:
    stylesheet = (
        PROJECT_ROOT
        / "Front"
        / "glass-effect2"
        / "navigation.css"
    ).read_text(encoding="utf-8")

    assert "@media (hover: hover) and (pointer: fine)" in stylesheet
    assert ".transport-play" in stylesheet
    assert ".track-toggle" in stylesheet
    assert ".range-control" in stylesheet
    assert "cursor: none !important" in stylesheet

