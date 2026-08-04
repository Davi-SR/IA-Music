"""Persistent local job queue and Demucs execution service."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yt_dlp

from backend.config import Settings
from backend.schemas import JobError, JobStatus, JobStatusResponse


LOGGER = logging.getLogger(__name__)
DEMUCS_MODEL = "htdemucs_6s"
STEMS = ("vocals", "drums", "bass", "guitar", "piano", "other")
ACTIVE_STATUSES = {
    JobStatus.QUEUED.value,
    JobStatus.PROCESSING.value,
    JobStatus.PACKAGING.value,
}


@dataclass(slots=True)
class JobReservation:
    """Paths and source data allocated to an incoming job."""

    job_id: str
    job_dir: Path
    input_path: Path
    original_name: str
    content_type: str | None
    source_url: str | None = None


@dataclass(slots=True)
class JobRecord:
    """Serializable internal job metadata."""

    job_id: str
    status: str
    original_name: str
    input_path: str
    content_type: str | None
    size_bytes: int
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    message: str | None = None
    output_zip: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    diagnostic: str | None = None
    source_url: str | None = None


class JobManager:
    """Manage uploads, YouTube sources, persistent state, and workers."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.settings.job_root.mkdir(parents=True, exist_ok=True)
        self._records: dict[str, JobRecord] = {}
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(
            max_workers=settings.max_concurrent_jobs,
            thread_name_prefix="demucs-job",
        )
        self._load_records()

    def reserve_upload(
        self,
        original_name: str,
        suffix: str,
        content_type: str | None,
    ) -> JobReservation:
        """Allocate an isolated directory for a file upload."""
        reservation = self._new_reservation(
            original_name=original_name,
            content_type=content_type,
        )
        reservation.input_path = reservation.input_path.with_suffix(suffix)
        return reservation

    def reserve_youtube(self, source_url: str) -> JobReservation:
        """Allocate an isolated directory for a YouTube download."""
        reservation = self._new_reservation(
            original_name="youtube-audio.mp3",
            content_type="audio/mpeg",
        )
        reservation.source_url = source_url
        reservation.input_path = reservation.input_path.with_suffix(".mp3")
        return reservation

    def discard(self, reservation: JobReservation) -> None:
        """Remove an incomplete reservation after a rejected source."""
        expected_parent = self.settings.job_root.resolve()
        target = reservation.job_dir.resolve()
        if target.parent == expected_parent:
            shutil.rmtree(target, ignore_errors=True)

    def enqueue(
        self,
        reservation: JobReservation,
        size_bytes: int = 0,
    ) -> JobRecord:
        """Persist a queued job and submit it to the local worker pool."""
        record = JobRecord(
            job_id=reservation.job_id,
            status=JobStatus.QUEUED.value,
            original_name=reservation.original_name,
            input_path=str(reservation.input_path),
            content_type=reservation.content_type,
            size_bytes=size_bytes,
            created_at=time.time(),
            message=(
                "URL recebida. Aguardando download."
                if reservation.source_url
                else "Arquivo recebido. Aguardando processamento."
            ),
            source_url=reservation.source_url,
        )
        with self._lock:
            self._records[record.job_id] = record
            self._persist(record)
        self._executor.submit(self._process_job, record.job_id)
        return record

    def get(self, job_id: str) -> JobRecord | None:
        """Return a detached job record if it exists."""
        with self._lock:
            record = self._records.get(job_id)
            return JobRecord(**asdict(record)) if record else None

    def to_response(self, record: JobRecord) -> JobStatusResponse:
        """Convert internal metadata into a safe public response."""
        elapsed: float | None = None
        if record.started_at is not None:
            elapsed = round(
                max(0.0, (record.finished_at or time.time()) - record.started_at),
                1,
            )
        error = (
            JobError(code=record.error_code, message=record.error_message)
            if record.error_code and record.error_message
            else None
        )
        completed = record.status == JobStatus.COMPLETED.value
        return JobStatusResponse(
            job_id=record.job_id,
            status=JobStatus(record.status),
            message=record.message,
            download_url=(
                f"/api/jobs/{record.job_id}/download" if completed else None
            ),
            elapsed_seconds=elapsed,
            stems=list(STEMS) if completed else None,
            error=error,
        )

    def output_path(self, record: JobRecord) -> Path | None:
        """Resolve a completed archive without accepting a client path."""
        if not record.output_zip:
            return None
        path = Path(record.output_zip)
        job_dir = (self.settings.job_root / record.job_id).resolve()
        try:
            path.resolve().relative_to(job_dir)
        except ValueError:
            LOGGER.error("Rejected unsafe archive path for job %s", record.job_id)
            return None
        return path if path.is_file() and path.stat().st_size > 0 else None

    def shutdown(self) -> None:
        """Stop accepting new jobs without terminating active subprocesses."""
        self._executor.shutdown(wait=False, cancel_futures=False)

    def _new_reservation(
        self,
        original_name: str,
        content_type: str | None,
    ) -> JobReservation:
        job_id = str(uuid.uuid4())
        job_dir = self.settings.job_root / job_id
        input_dir = job_dir / "input"
        input_dir.mkdir(parents=True, exist_ok=False)
        return JobReservation(
            job_id=job_id,
            job_dir=job_dir,
            input_path=input_dir / "source",
            original_name=original_name,
            content_type=content_type,
        )

    def _load_records(self) -> None:
        for metadata_path in self.settings.job_root.glob("*/job.json"):
            try:
                payload: dict[str, Any] = json.loads(
                    metadata_path.read_text(encoding="utf-8")
                )
                record = JobRecord(**payload)
                uuid.UUID(record.job_id)
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                LOGGER.warning("Ignoring invalid job metadata: %s", metadata_path)
                continue
            if record.status in ACTIVE_STATUSES:
                record.status = JobStatus.FAILED.value
                record.finished_at = time.time()
                record.message = "O servidor reiniciou durante o processamento."
                record.error_code = "SERVER_RESTARTED"
                record.error_message = (
                    "O processamento foi interrompido. Envie a origem novamente."
                )
                self._persist(record)
            self._records[record.job_id] = record

    def _process_job(self, job_id: str) -> None:
        record = self.get(job_id)
        if record is None:
            return
        self._update(
            job_id,
            status=JobStatus.PROCESSING.value,
            started_at=time.time(),
            message=(
                "Baixando e preparando o áudio do YouTube."
                if record.source_url
                else f"Separando seis stems com {DEMUCS_MODEL}."
            ),
        )
        input_path = Path(record.input_path)
        separated_dir = self.settings.job_root / job_id / "separated"

        try:
            if record.source_url:
                input_path, media_title = self._download_youtube_audio(
                    job_id, record.source_url, input_path
                )
                record.original_name = f"{media_title}.mp3"
                self._update(
                    job_id,
                    input_path=str(input_path),
                    original_name=record.original_name,
                    size_bytes=input_path.stat().st_size,
                    message=f"Separando seis stems com {DEMUCS_MODEL}.",
                )

            command = [
                self.settings.demucs_executable,
                "-n",
                DEMUCS_MODEL,
                "--device",
                self.settings.demucs_device,
                "--segment",
                str(self.settings.demucs_segment_seconds),
                "--shifts",
                str(self.settings.demucs_shifts),
                "--jobs",
                str(self.settings.demucs_jobs),
                "--out",
                str(separated_dir),
                str(input_path),
            ]
            LOGGER.info(
                "Starting Demucs job %s with device=%s segment=%s shifts=%s jobs=%s",
                job_id,
                self.settings.demucs_device,
                self.settings.demucs_segment_seconds,
                self.settings.demucs_shifts,
                self.settings.demucs_jobs,
            )
            result = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=self.settings.process_timeout_seconds,
            )
            LOGGER.debug("Demucs output for %s: %s", job_id, result.stdout)

            stem_dir = separated_dir / DEMUCS_MODEL / input_path.stem
            stem_paths = [stem_dir / f"{stem}.wav" for stem in STEMS]
            missing = [
                path.name
                for path in stem_paths
                if not path.is_file() or path.stat().st_size == 0
            ]
            if missing:
                raise RuntimeError(
                    "Demucs did not create: " + ", ".join(missing)
                )

            self._update(
                job_id,
                status=JobStatus.PACKAGING.value,
                message="Compactando os seis stems.",
            )
            output_zip = self._create_archive(job_id, record, stem_paths)
            self._update(
                job_id,
                status=JobStatus.COMPLETED.value,
                finished_at=time.time(),
                message="Separação concluída. O ZIP está pronto para download.",
                output_zip=str(output_zip),
                diagnostic=None,
            )
            LOGGER.info("Completed Demucs job %s", job_id)
        except FileNotFoundError as exc:
            self._fail(
                job_id,
                "DEPENDENCY_NOT_AVAILABLE",
                "FFmpeg, yt-dlp ou Demucs não está disponível no servidor.",
                str(exc),
            )
        except yt_dlp.utils.DownloadError as exc:
            self._fail(
                job_id,
                "YOUTUBE_DOWNLOAD_FAILED",
                "Não foi possível baixar o áudio deste vídeo do YouTube.",
                str(exc)[-4000:],
            )
        except subprocess.TimeoutExpired as exc:
            self._fail(
                job_id,
                "PROCESSING_TIMEOUT",
                "O processamento excedeu o tempo limite do servidor.",
                str(exc),
            )
        except subprocess.CalledProcessError as exc:
            diagnostic = (exc.stderr or exc.stdout or str(exc)).strip()[-4000:]
            user_message = "Não foi possível separar este áudio."
            if exc.returncode < 0:
                diagnostic = (
                    f"Demucs was terminated by signal {-exc.returncode}. "
                    "This usually means the container ran out of memory or CPU time.\n"
                    f"{diagnostic}"
                ).strip()[-4000:]
                user_message = (
                    "O servidor ficou sem recursos para separar esse áudio. "
                    "Estamos ajustando a capacidade de processamento."
                )
            self._fail(
                job_id,
                "SEPARATION_FAILED",
                user_message,
                diagnostic,
            )
        except Exception as exc:
            LOGGER.exception("Unexpected failure in job %s", job_id)
            self._fail(
                job_id,
                "PROCESSING_FAILED",
                "O processamento falhou inesperadamente.",
                str(exc)[-4000:],
            )

    def _download_youtube_audio(
        self,
        job_id: str,
        source_url: str,
        expected_path: Path,
    ) -> tuple[Path, str]:
        """Download one YouTube video and convert its best audio to MP3."""
        options: dict[str, Any] = {
            "format": "bestaudio/best",
            "noplaylist": True,
            "outtmpl": str(expected_path.with_suffix(".%(ext)s")),
            "quiet": True,
            "no_warnings": True,
            "retries": 5,
            "fragment_retries": 5,
            "extractor_retries": 3,
            "socket_timeout": 30,
            "http_headers": {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
            },
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "0",
                }
            ],
        }
        if self.settings.ffmpeg_directory:
            options["ffmpeg_location"] = str(self.settings.ffmpeg_directory)
        cookie_loaded = False
        if self.settings.youtube_cookie_file:
            if self.settings.youtube_cookie_file.is_file():
                options["cookiefile"] = str(self.settings.youtube_cookie_file)
                cookie_loaded = True
            else:
                LOGGER.warning(
                    "Configured YouTube cookie file does not exist: %s",
                    self.settings.youtube_cookie_file,
                )

        LOGGER.info(
            "yt-dlp YouTube environment for job %s: version=%s deno=%s cookiefile=%s cookie_bytes=%s",
            job_id,
            getattr(yt_dlp.version, "__version__", "unknown"),
            shutil.which("deno") or "not-found",
            "configured" if cookie_loaded else "not-configured",
            self.settings.youtube_cookie_file.stat().st_size if cookie_loaded else 0,
        )
        LOGGER.info("Downloading YouTube source for job %s", job_id)
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(source_url, download=True)
        if not expected_path.is_file() or expected_path.stat().st_size == 0:
            raise RuntimeError("yt-dlp did not produce the expected MP3.")
        raw_title = str(info.get("title") or "youtube-audio")
        safe_title = "".join(
            char if char.isalnum() or char in {"-", "_", " "} else "_"
            for char in raw_title
        ).strip()[:120]
        return expected_path, safe_title or "youtube-audio"

    def _create_archive(
        self,
        job_id: str,
        record: JobRecord,
        stem_paths: list[Path],
    ) -> Path:
        result_dir = self.settings.job_root / job_id / "result"
        result_dir.mkdir(parents=True, exist_ok=True)
        safe_stem = "".join(
            char if char.isalnum() or char in {"-", "_"} else "_"
            for char in Path(record.original_name).stem
        ).strip("_")[:80]
        archive_path = result_dir / f"{safe_stem or 'audio'}_stems.zip"
        temporary_path = archive_path.with_suffix(".zip.tmp")
        with zipfile.ZipFile(
            temporary_path,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            for stem_path in stem_paths:
                archive.write(stem_path, arcname=stem_path.name)
        temporary_path.replace(archive_path)
        return archive_path

    def _fail(
        self,
        job_id: str,
        code: str,
        user_message: str,
        diagnostic: str,
    ) -> None:
        LOGGER.error("Job %s failed (%s): %s", job_id, code, diagnostic)
        self._update(
            job_id,
            status=JobStatus.FAILED.value,
            finished_at=time.time(),
            message=user_message,
            error_code=code,
            error_message=user_message,
            diagnostic=diagnostic,
        )

    def _update(self, job_id: str, **changes: Any) -> None:
        with self._lock:
            record = self._records[job_id]
            for field_name, value in changes.items():
                setattr(record, field_name, value)
            self._persist(record)

    def _persist(self, record: JobRecord) -> None:
        job_dir = self.settings.job_root / record.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = job_dir / "job.json"
        temporary_path = job_dir / "job.json.tmp"
        temporary_path.write_text(
            json.dumps(asdict(record), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_path.replace(metadata_path)
