"""Cache policy tests for the React production build."""

from __future__ import annotations

import re

from fastapi.testclient import TestClient

import main


def test_html_entries_are_revalidated() -> None:
    client = TestClient(main.app)

    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/musics.html").headers["cache-control"] == "no-cache"


def test_built_and_fingerprinted_assets_follow_static_cache_policy() -> None:
    client = TestClient(main.app)
    html = client.get("/").text
    match = re.search(r'src="(\./react-assets/[^"]+\.js)"', html)
    assert match is not None

    built = client.get("/" + match.group(1).removeprefix("./"))
    fingerprinted = client.get("/assets/iconify_654a1ef798a3.js")

    assert built.status_code == 200
    assert built.headers["cache-control"] == "public, max-age=300"
    assert fingerprinted.headers["cache-control"] == (
        "public, max-age=604800, immutable"
    )
