"""Application factory wired to the progress-aware job manager."""

from __future__ import annotations

from fastapi import FastAPI

from backend.app import create_app as create_base_app
from backend.config import Settings
from backend.progress_jobs import ProgressJobManager


def create_app(
    settings: Settings | None = None,
    manager: ProgressJobManager | None = None,
) -> FastAPI:
    """Create the API using measured progress by default."""
    resolved_settings = settings or Settings()
    resolved_manager = manager or ProgressJobManager(resolved_settings)
    return create_base_app(resolved_settings, resolved_manager)

