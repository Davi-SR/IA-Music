"""Typed API response models."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class JobStatus(str, Enum):
    """Public lifecycle states for a source-separation job."""

    QUEUED = "queued"
    PROCESSING = "processing"
    PACKAGING = "packaging"
    COMPLETED = "completed"
    FAILED = "failed"


class JobError(BaseModel):
    """A safe, machine-readable error returned to the client."""

    code: str
    message: str


class JobCreateResponse(BaseModel):
    """Response returned after a source is accepted."""

    job_id: str
    status: JobStatus


class JobStatusResponse(BaseModel):
    """Current state, measured progress, and outputs of a job."""

    job_id: str
    status: JobStatus
    message: str | None = None
    progress_percent: int | None = None
    download_url: str | None = None
    elapsed_seconds: float | None = None
    stems: list[str] | None = None
    error: JobError | None = None


class HealthResponse(BaseModel):
    """Basic service readiness response."""

    status: str
    service: str

