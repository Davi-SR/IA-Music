"""Cache policy tests for static assets."""

from __future__ import annotations

from fastapi.testclient import TestClient

import main


def test_html_and_runtime_config_are_revalidated() -> None:
    client = TestClient(main.app)

    home = client.get("/")
    config = client.get("/config.js")

    assert home.headers["cache-control"] == "no-cache"
    assert config.headers["cache-control"] == "no-cache"


def test_versioned_and_fingerprinted_assets_are_immutable() -> None:
    client = TestClient(main.app)

    versioned = client.get("/youtube-v2.js?v=5")
    fingerprinted = client.get("/assets/iconify_654a1ef798a3.js")

    expected = "public, max-age=604800, immutable"
    assert versioned.headers["cache-control"] == expected
    assert fingerprinted.headers["cache-control"] == expected

