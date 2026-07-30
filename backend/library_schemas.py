"""Response models for the completed music library."""

from __future__ import annotations

from pydantic import BaseModel


class LibraryStem(BaseModel):
    """Playable and downloadable stem links."""

    id: str
    name: str
    stream_url: str
    download_url: str


class LibraryItem(BaseModel):
    """A completed separation available in the local library."""

    job_id: str
    title: str
    source_type: str
    created_at: float
    completed_at: float | None
    duration_seconds: float | None
    download_url: str
    stems: list[LibraryStem]


class LibraryResponse(BaseModel):
    """Completed jobs collection."""

    items: list[LibraryItem]

