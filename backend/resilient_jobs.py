"""Windows/OneDrive-safe persistence for progress-aware jobs."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import asdict

from backend.jobs import JobRecord
from backend.progress_jobs import ProgressJobManager


LOGGER = logging.getLogger(__name__)
PERSIST_ATTEMPTS = 10
MAX_RETRY_DELAY_SECONDS = 0.6


class ResilientProgressJobManager(ProgressJobManager):
    """Persist metadata despite transient file locks from sync software."""

    def _persist(self, record: JobRecord) -> None:
        job_dir = self.settings.job_root / record.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = job_dir / "job.json"
        serialized = json.dumps(
            asdict(record),
            ensure_ascii=False,
            indent=2,
        )

        last_error: OSError | None = None
        for attempt in range(PERSIST_ATTEMPTS):
            temporary_path = job_dir / (
                f".job-{threading.get_ident()}-{uuid.uuid4().hex}.tmp"
            )
            try:
                temporary_path.write_text(serialized, encoding="utf-8")
                os.replace(temporary_path, metadata_path)
                if attempt:
                    LOGGER.info(
                        "Job metadata persisted after %d retries: %s",
                        attempt,
                        record.job_id,
                    )
                return
            except OSError as exc:
                last_error = exc
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
                if attempt + 1 < PERSIST_ATTEMPTS:
                    delay = min(
                        MAX_RETRY_DELAY_SECONDS,
                        0.04 * (2**attempt),
                    )
                    time.sleep(delay)

        # The in-memory record remains authoritative and processing continues.
        # A later status update will attempt persistence again.
        LOGGER.error(
            "Could not persist metadata for job %s after %d attempts; "
            "continuing with in-memory state: %s",
            record.job_id,
            PERSIST_ATTEMPTS,
            last_error,
        )

