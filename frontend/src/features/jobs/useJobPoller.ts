import { useEffect, useRef } from "react";
import { ApiError, getJob } from "../../api/client";
import { config } from "../../config";
import type { JobResponse } from "../../types";

interface PollerOptions {
  jobId: string | null;
  enabled: boolean;
  onJob: (job: JobResponse) => boolean;
  onTemporaryFailure: (error: unknown, failures: number) => void;
  onMissing: () => void;
}

export function useJobPoller({
  jobId,
  enabled,
  onJob,
  onTemporaryFailure,
  onMissing,
}: PollerOptions): void {
  const handlers = useRef({ onJob, onTemporaryFailure, onMissing });
  handlers.current = { onJob, onTemporaryFailure, onMissing };

  useEffect(() => {
    if (!enabled || !jobId) return;
    let alive = true;
    let timer: number | null = null;
    let failures = 0;
    let request: AbortController | null = null;

    const poll = async () => {
      request = new AbortController();
      try {
        const job = await getJob(jobId, request.signal);
        if (!alive) return;
        failures = 0;
        const terminal = handlers.current.onJob(job);
        if (!terminal) {
          timer = window.setTimeout(poll, config.initialPollDelayMs);
        }
      } catch (error) {
        if (!alive || (error instanceof ApiError && error.kind === "cancelled")) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          handlers.current.onMissing();
          return;
        }
        failures += 1;
        handlers.current.onTemporaryFailure(error, failures);
        const delay = Math.min(
          config.maxPollDelayMs,
          config.initialPollDelayMs * 2 ** Math.min(failures - 1, 4),
        );
        timer = window.setTimeout(poll, delay);
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      request?.abort();
    };
  }, [enabled, jobId]);
}
