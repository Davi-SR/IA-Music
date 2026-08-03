"""Job manager with measured yt-dlp and Demucs progress."""

from __future__ import annotations

import logging
import queue
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import yt_dlp

from backend.config import Settings
from backend.jobs import DEMUCS_MODEL, STEMS, JobManager, JobRecord, JobReservation
from backend.schemas import JobStatus, JobStatusResponse


LOGGER = logging.getLogger(__name__)
PERCENT_PATTERN = re.compile(r"(?<!\d)(\d{1,3})%")


class ProgressJobManager(JobManager):
    """Report progress based on bytes downloaded and Demucs CLI output."""

    def __init__(self, settings: Settings) -> None:
        self._progress: dict[str, int] = {}
        self._progress_lock = threading.RLock()
        super().__init__(settings)

    def enqueue(
        self,
        reservation: JobReservation,
        size_bytes: int = 0,
    ) -> JobRecord:
        self._set_progress(reservation.job_id, 1)
        return super().enqueue(reservation, size_bytes)

    def to_response(self, record: JobRecord) -> JobStatusResponse:
        response = super().to_response(record)
        with self._progress_lock:
            measured = self._progress.get(record.job_id)
        if measured is None:
            measured = {
                JobStatus.QUEUED.value: 1,
                JobStatus.PROCESSING.value: 30,
                JobStatus.PACKAGING.value: 92,
                JobStatus.COMPLETED.value: 100,
                JobStatus.FAILED.value: 0,
            }.get(record.status, 0)
        return response.model_copy(update={"progress_percent": measured})

    def _process_job(self, job_id: str) -> None:
        record = self.get(job_id)
        if record is None:
            return
        self._set_progress(job_id, 3)
        self._update(
            job_id,
            status=JobStatus.PROCESSING.value,
            started_at=time.time(),
            message=(
                "Buscando o áudio do vídeo na melhor qualidade disponível."
                if record.source_url
                else "Preparando seu áudio para separar cada instrumento."
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
                    message="O áudio chegou. Agora vamos revelar cada camada da música.",
                )

            self._set_progress(job_id, 30)
            self._update(
                job_id,
                message="A inteligência artificial está identificando cada instrumento.",
            )
            self._run_demucs(job_id, input_path, separated_dir)

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

            self._set_progress(job_id, 92)
            self._update(
                job_id,
                status=JobStatus.PACKAGING.value,
                message="Organizando suas faixas para deixar tudo pronto para baixar.",
            )
            output_zip = self._create_archive(job_id, record, stem_paths)
            self._set_progress(job_id, 99)
            self._update(
                job_id,
                message="Só mais um instante: estamos conferindo o pacote final.",
            )
            self._set_progress(job_id, 100)
            self._update(
                job_id,
                status=JobStatus.COMPLETED.value,
                finished_at=time.time(),
                message="Pronto! Todas as faixas foram separadas com sucesso.",
                output_zip=str(output_zip),
                diagnostic=None,
            )
            LOGGER.info("Completed job %s", job_id)
        except FileNotFoundError as exc:
            self._fail(
                job_id,
                "DEPENDENCY_NOT_AVAILABLE",
                "Um componente necessário não está disponível no servidor.",
                str(exc),
            )
        except yt_dlp.utils.DownloadError as exc:
            self._fail(
                job_id,
                "YOUTUBE_DOWNLOAD_FAILED",
                "Não conseguimos acessar o áudio desse vídeo. Confira o link e tente novamente.",
                str(exc)[-4000:],
            )
        except subprocess.TimeoutExpired as exc:
            self._fail(
                job_id,
                "PROCESSING_TIMEOUT",
                "Esse áudio levou mais tempo que o esperado para processar.",
                str(exc),
            )
        except subprocess.CalledProcessError as exc:
            diagnostic = (exc.stderr or exc.stdout or str(exc)).strip()[-4000:]
            self._fail(
                job_id,
                "SEPARATION_FAILED",
                "Não conseguimos separar as faixas desse áudio.",
                diagnostic,
            )
        except Exception as exc:
            LOGGER.exception("Unexpected failure in job %s", job_id)
            self._fail(
                job_id,
                "PROCESSING_FAILED",
                "Algo inesperado interrompeu o processamento.",
                str(exc)[-4000:],
            )

    def _download_youtube_audio(
        self,
        job_id: str,
        source_url: str,
        expected_path: Path,
    ) -> tuple[Path, str]:
        last_percent = -1

        def progress_hook(data: dict[str, Any]) -> None:
            nonlocal last_percent
            status = data.get("status")
            if status == "downloading":
                downloaded = int(data.get("downloaded_bytes") or 0)
                total = int(
                    data.get("total_bytes")
                    or data.get("total_bytes_estimate")
                    or 0
                )
                if total > 0:
                    download_percent = min(100, int(downloaded * 100 / total))
                    mapped = 5 + int(download_percent * 0.20)
                    if mapped != last_percent:
                        last_percent = mapped
                        self._set_progress(job_id, mapped)
            elif status == "finished":
                self._set_progress(job_id, 26)
                self._update(
                    job_id,
                    message="Download concluído. Estamos preparando o áudio.",
                )

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
            "progress_hooks": [progress_hook],
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
        if self.settings.youtube_cookie_file:
            if self.settings.youtube_cookie_file.is_file():
                options["cookiefile"] = str(self.settings.youtube_cookie_file)
            else:
                LOGGER.warning(
                    "Configured YouTube cookie file does not exist: %s",
                    self.settings.youtube_cookie_file,
                )

        LOGGER.info("Downloading YouTube source for job %s", job_id)
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(source_url, download=True)
        self._set_progress(job_id, 29)
        if not expected_path.is_file() or expected_path.stat().st_size == 0:
            raise RuntimeError("yt-dlp did not produce the expected MP3.")
        raw_title = str(info.get("title") or "youtube-audio")
        safe_title = "".join(
            char if char.isalnum() or char in {"-", "_", " "} else "_"
            for char in raw_title
        ).strip()[:120]
        return expected_path, safe_title or "youtube-audio"

    def _run_demucs(
        self,
        job_id: str,
        input_path: Path,
        separated_dir: Path,
    ) -> None:
        command = [
            self.settings.demucs_executable,
            "-n",
            DEMUCS_MODEL,
            "--out",
            str(separated_dir),
            str(input_path),
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_queue: queue.Queue[str | None] = queue.Queue()

        def read_output() -> None:
            assert process.stdout is not None
            try:
                for line in process.stdout:
                    output_queue.put(line)
            finally:
                output_queue.put(None)

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        deadline = time.monotonic() + self.settings.process_timeout_seconds
        diagnostics: list[str] = []
        output_finished = False

        while process.poll() is None or not output_finished:
            if time.monotonic() > deadline:
                process.kill()
                raise subprocess.TimeoutExpired(
                    command, self.settings.process_timeout_seconds
                )
            try:
                line = output_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if line is None:
                output_finished = True
                continue
            diagnostics.append(line)
            matches = PERCENT_PATTERN.findall(line)
            if matches:
                model_percent = min(100, int(matches[-1]))
                mapped = 30 + int(model_percent * 0.60)
                self._set_progress(job_id, mapped)
                self._update_friendly_message(job_id, mapped)

        return_code = process.wait()
        diagnostic = "".join(diagnostics)[-4000:]
        if return_code != 0:
            raise subprocess.CalledProcessError(
                return_code,
                command,
                output=diagnostic,
                stderr=diagnostic,
            )
        self._set_progress(job_id, 90)

    def _update_friendly_message(self, job_id: str, progress: int) -> None:
        if progress < 50:
            message = "Reconhecendo voz, ritmo e harmonia no seu áudio."
        elif progress < 72:
            message = "Dando espaço para cada instrumento aparecer com clareza."
        elif progress < 86:
            message = "As faixas estão ganhando forma. Já avançamos bastante."
        else:
            message = "Ajustando os últimos detalhes da separação."

        current = self.get(job_id)
        if current and current.message != message:
            self._update(job_id, message=message)

    def _set_progress(self, job_id: str, value: int) -> None:
        with self._progress_lock:
            previous = self._progress.get(job_id, 0)
            self._progress[job_id] = max(previous, min(100, int(value)))
