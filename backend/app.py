"""FastAPI application and HTTP contract for MUSICAI."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.auth import (
    AuthService,
    install_auth_routes,
    require_job_owner,
    require_user,
)
from backend.config import Settings
from backend.jobs import JobManager
from backend.schemas import (
    HealthResponse,
    JobCreateResponse,
    JobStatus,
    JobStatusResponse,
)


LOGGER = logging.getLogger(__name__)
ALLOWED_EXTENSIONS = {".mp3", ".wav"}
ALLOWED_CONTENT_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "application/octet-stream",
}
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}
UPLOAD_CHUNK_SIZE = 1024 * 1024


class ApiError(Exception):
    """HTTP error carrying a stable public code and safe message."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _validate_youtube_url(raw_url: str) -> str:
    """Return a normalized URL if it targets a supported YouTube host."""
    source_url = raw_url.strip()
    if len(source_url) > 2048:
        raise ApiError(400, "URL_TOO_LONG", "A URL informada é muito longa.")
    try:
        parsed = urlparse(source_url)
        hostname = (parsed.hostname or "").lower()
    except ValueError as exc:
        raise ApiError(
            400, "INVALID_YOUTUBE_URL", "Informe uma URL válida do YouTube."
        ) from exc
    if parsed.scheme not in {"http", "https"} or hostname not in YOUTUBE_HOSTS:
        raise ApiError(
            400, "INVALID_YOUTUBE_URL", "Informe uma URL válida do YouTube."
        )
    if not parsed.path or parsed.path == "/":
        raise ApiError(
            400,
            "INVALID_YOUTUBE_URL",
            "A URL deve identificar um vídeo do YouTube.",
        )
    return source_url


def create_app(
    settings: Settings | None = None,
    manager: JobManager | None = None,
    auth_service: AuthService | None = None,
) -> FastAPI:
    """Create the application, allowing dependencies to be injected in tests."""
    resolved_settings = settings or Settings()
    job_manager = manager or JobManager(resolved_settings)
    resolved_auth = auth_service or AuthService(resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        job_manager.shutdown()

    app = FastAPI(
        title="MUSICAI Audio Separation API",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.job_manager = job_manager
    install_auth_routes(
        app,
        resolved_settings,
        resolved_auth,
        (
            path.parent.name
            for path in resolved_settings.job_root.glob("*/job.json")
        ),
    )

    if resolved_settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(resolved_settings.cors_origins),
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Accept", "Content-Type"],
        )

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, _: RequestValidationError
    ) -> JSONResponse:
        if request.url.path.startswith("/api/auth/"):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "error": {
                        "code": "INVALID_AUTH_REQUEST",
                        "message": "Confira os campos informados e tente novamente.",
                    }
                },
            )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": (
                        "Envie um arquivo no campo 'file' ou uma URL no campo "
                        "'youtube_url'."
                    ),
                }
            },
        )

    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", service="musicai-api")

    @app.post(
        "/api/jobs",
        response_model=JobCreateResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def create_job(
        request: Request,
        file: UploadFile | None = File(default=None),
        youtube_url: str | None = Form(default=None),
    ) -> JobCreateResponse:
        user = require_user(request)
        has_file = file is not None and bool(file.filename)
        has_url = bool(youtube_url and youtube_url.strip())
        if has_file == has_url:
            if file is not None:
                await file.close()
            raise ApiError(
                400,
                "EXACTLY_ONE_SOURCE_REQUIRED",
                "Envie um arquivo ou uma URL do YouTube, mas não os dois.",
            )

        if has_url:
            source_url = _validate_youtube_url(youtube_url or "")
            reservation = job_manager.reserve_youtube(source_url)
            resolved_auth.claim_job(reservation.job_id, user.id)
            record = job_manager.enqueue(reservation)
            return JobCreateResponse(
                job_id=record.job_id,
                status=JobStatus(record.status),
            )

        assert file is not None
        original_name = Path(file.filename or "").name.strip()
        if not original_name:
            await file.close()
            raise ApiError(400, "INVALID_FILENAME", "O arquivo não tem nome.")
        if len(original_name) > 180:
            await file.close()
            raise ApiError(
                400,
                "FILENAME_TOO_LONG",
                "O nome do arquivo deve ter no máximo 180 caracteres.",
            )
        suffix = Path(original_name).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            await file.close()
            raise ApiError(
                415,
                "UNSUPPORTED_FILE_TYPE",
                "Formato não suportado. Envie um arquivo MP3 ou WAV.",
            )
        if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
            await file.close()
            raise ApiError(
                415,
                "UNSUPPORTED_MEDIA_TYPE",
                "O tipo de mídia enviado não corresponde a MP3 ou WAV.",
            )

        reservation = job_manager.reserve_upload(
            original_name=original_name,
            suffix=suffix,
            content_type=file.content_type,
        )
        size_bytes = 0
        try:
            with reservation.input_path.open("wb") as destination:
                while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                    size_bytes += len(chunk)
                    if size_bytes > resolved_settings.max_upload_bytes:
                        raise ApiError(
                            413,
                            "FILE_TOO_LARGE",
                            "O arquivo excede o limite de 500 MB.",
                        )
                    destination.write(chunk)
        except ApiError:
            job_manager.discard(reservation)
            raise
        except OSError as exc:
            job_manager.discard(reservation)
            LOGGER.exception("Could not persist upload")
            raise ApiError(
                500,
                "UPLOAD_STORAGE_FAILED",
                "Não foi possível armazenar o arquivo enviado.",
            ) from exc
        finally:
            await file.close()

        if size_bytes == 0:
            job_manager.discard(reservation)
            raise ApiError(400, "EMPTY_FILE", "O arquivo enviado está vazio.")

        resolved_auth.claim_job(reservation.job_id, user.id)
        record = job_manager.enqueue(reservation, size_bytes)
        return JobCreateResponse(
            job_id=record.job_id,
            status=JobStatus(record.status),
        )

    @app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
    async def get_job(job_id: str, request: Request) -> JobStatusResponse:
        require_job_owner(request, job_id)
        record = job_manager.get(job_id)
        if record is None:
            raise ApiError(404, "JOB_NOT_FOUND", "Job não encontrado.")
        return job_manager.to_response(record)

    @app.get("/api/jobs/{job_id}/download")
    async def download_job(job_id: str, request: Request) -> FileResponse:
        require_job_owner(request, job_id)
        record = job_manager.get(job_id)
        if record is None:
            raise ApiError(404, "JOB_NOT_FOUND", "Job não encontrado.")
        if record.status != JobStatus.COMPLETED.value:
            raise ApiError(
                409,
                "JOB_NOT_COMPLETED",
                "O arquivo ainda não está pronto para download.",
            )
        archive_path = job_manager.output_path(record)
        if archive_path is None:
            raise ApiError(
                410,
                "RESULT_NOT_AVAILABLE",
                "O resultado deste job não está mais disponível.",
            )
        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename=archive_path.name,
        )

    if resolved_settings.frontend_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=resolved_settings.frontend_dir, html=True),
            name="frontend",
        )
    else:
        LOGGER.warning(
            "Front-end directory does not exist: %s",
            resolved_settings.frontend_dir,
        )
    return app

