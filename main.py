"""MUSICAI FastAPI entry point."""

from __future__ import annotations

import logging

import uvicorn

from backend.application import create_app
from backend.cache import install_static_cache_policy


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

app = create_app()
install_static_cache_policy(app)


def main() -> None:
    """Run the development server."""
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
