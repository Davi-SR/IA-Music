"""Ensure React components cannot reveal the native pointer on mouse."""

from __future__ import annotations

from backend.config import PROJECT_ROOT


def test_interactive_components_force_custom_cursor_on_mouse() -> None:
    styles_root = PROJECT_ROOT / "frontend" / "src" / "styles"
    stylesheet = (
        (styles_root / "navigation.css").read_text(encoding="utf-8")
        + (styles_root / "react.css").read_text(encoding="utf-8")
    )

    assert "@media (hover: hover) and (pointer: fine)" in stylesheet
    assert ".transport-play" in stylesheet
    assert ".track-toggle" in stylesheet
    assert ".range-control" in stylesheet
    assert "cursor: none !important" in stylesheet
    assert "[tabindex]:not([tabindex=\"-1\"])" in stylesheet
