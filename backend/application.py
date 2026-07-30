"""Production application with jobs, progress, library, and stem playback."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from backend.app import ApiError, create_app as create_base_app
from backend.config import Settings
from backend.jobs import STEMS
from backend.library import LibraryJobManager
from backend.library_schemas import LibraryItem, LibraryResponse, LibraryStem


STEM_NAMES = {
    "vocals": "Voz",
    "drums": "Bateria",
    "bass": "Baixo",
    "guitar": "Guitarra",
    "piano": "Piano",
    "other": "Outros",
}


def _safe_download_title(original_name: str) -> str:
    title = "".join(
        character
        if character.isalnum() or character in {"-", "_", " "}
        else "_"
        for character in Path(original_name).stem
    ).strip()
    return title[:80] or "audio"


def create_app(
    settings: Settings | None = None,
    manager: LibraryJobManager | None = None,
) -> FastAPI:
    """Create the full API and keep the catch-all static mount last."""
    resolved_settings = settings or Settings()
    resolved_manager = manager or LibraryJobManager(resolved_settings)
    app = create_base_app(resolved_settings, resolved_manager)

    static_mount = next(
        (route for route in app.router.routes if route.name == "frontend"),
        None,
    )
    if static_mount is not None:
        app.router.routes.remove(static_mount)

    @app.get("/api/library", response_model=LibraryResponse)
    async def list_library() -> LibraryResponse:
        items: list[LibraryItem] = []
        for record in resolved_manager.list_completed():
            available_stems = [
                stem
                for stem in STEMS
                if resolved_manager.get_stem_path(record, stem) is not None
            ]
            items.append(
                LibraryItem(
                    job_id=record.job_id,
                    title=Path(record.original_name).stem,
                    source_type=(
                        "youtube" if record.source_url else "upload"
                    ),
                    created_at=record.created_at,
                    completed_at=record.finished_at,
                    duration_seconds=resolved_manager.get_duration(record),
                    download_url=f"/api/jobs/{record.job_id}/download",
                    stems=[
                        LibraryStem(
                            id=stem,
                            name=STEM_NAMES[stem],
                            stream_url=(
                                f"/api/jobs/{record.job_id}/stems/{stem}"
                            ),
                            download_url=(
                                f"/api/jobs/{record.job_id}/stems/{stem}"
                                "/download"
                            ),
                        )
                        for stem in available_stems
                    ],
                )
            )
        return LibraryResponse(items=items)

    @app.get("/api/jobs/{job_id}/stems/{stem}")
    async def stream_stem(job_id: str, stem: str) -> FileResponse:
        record = resolved_manager.get(job_id)
        if record is None:
            raise ApiError(404, "JOB_NOT_FOUND", "Música não encontrada.")
        stem_path = resolved_manager.get_stem_path(record, stem)
        if stem_path is None:
            raise ApiError(404, "STEM_NOT_FOUND", "Faixa não encontrada.")
        return FileResponse(
            stem_path,
            media_type="audio/wav",
            content_disposition_type="inline",
            headers={"Cache-Control": "private, max-age=3600"},
        )

    @app.get("/api/jobs/{job_id}/stems/{stem}/download")
    async def download_stem(job_id: str, stem: str) -> FileResponse:
        record = resolved_manager.get(job_id)
        if record is None:
            raise ApiError(404, "JOB_NOT_FOUND", "Música não encontrada.")
        stem_path = resolved_manager.get_stem_path(record, stem)
        if stem_path is None:
            raise ApiError(404, "STEM_NOT_FOUND", "Faixa não encontrada.")
        filename = f"{_safe_download_title(record.original_name)}_{stem}.wav"
        return FileResponse(
            stem_path,
            media_type="audio/wav",
            filename=filename,
        )

    if static_mount is not None:
        app.router.routes.append(static_mount)
    return app

