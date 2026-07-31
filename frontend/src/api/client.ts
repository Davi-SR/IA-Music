import { apiUrl, config } from "../config";
import type { JobResponse, LibraryResponse } from "../types";

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "cancelled"
  | "invalid_response"
  | "server"
  | "http"
  | "unknown";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly details: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      kind?: ApiErrorKind;
      status?: number | null;
      code?: string | null;
      details?: string | null;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = options.kind ?? "unknown";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.details = options.details ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function parseJson<T>(raw: string, status: number): T {
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new ApiError("O servidor retornou uma resposta inválida.", {
      kind: "invalid_response",
      status,
      details: error instanceof Error ? error.message : String(error),
      retryable: status >= 500,
    });
  }
}

function fromResponse(payload: unknown, status: number): ApiError {
  const data = payload as {
    error?: { code?: string; message?: string; details?: string };
    detail?: string;
    message?: string;
  };
  return new ApiError(
    data.error?.message ??
      data.detail ??
      data.message ??
      `O servidor respondeu com status ${status}.`,
    {
      kind: status >= 500 ? "server" : "http",
      status,
      code: data.error?.code ?? null,
      details: data.error?.details ?? null,
      retryable: status === 408 || status === 429 || status >= 500,
    },
  );
}

export function createFileJob(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: {
      loaded: number;
      total: number;
      percent: number;
    }) => void;
  } = {},
): Promise<JobResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append(config.uploadFieldName, file, file.name);
    request.open("POST", apiUrl(config.endpoints.createJob));
    request.responseType = "text";
    request.withCredentials = true;
    request.timeout = config.uploadTimeoutMs;
    request.setRequestHeader("Accept", "application/json");

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
      });
    });
    request.addEventListener("load", () => {
      try {
        const payload = parseJson<JobResponse>(request.responseText, request.status);
        if (request.status < 200 || request.status >= 300) {
          reject(fromResponse(payload, request.status));
        } else if (!payload.job_id) {
          reject(
            new ApiError("O servidor não retornou um identificador de job.", {
              kind: "invalid_response",
              status: request.status,
            }),
          );
        } else {
          resolve(payload);
        }
      } catch (error) {
        reject(error);
      }
    });
    request.addEventListener("error", () =>
      reject(
        new ApiError(
          "Não foi possível enviar o arquivo. Verifique sua conexão.",
          { kind: "network", retryable: true },
        ),
      ),
    );
    request.addEventListener("timeout", () =>
      reject(
        new ApiError("O envio excedeu o tempo limite.", {
          kind: "timeout",
          retryable: true,
        }),
      ),
    );
    request.addEventListener("abort", () =>
      reject(
        new ApiError("O envio foi cancelado.", {
          kind: "cancelled",
          retryable: true,
        }),
      ),
    );
    const abort = () => request.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    request.addEventListener(
      "loadend",
      () => options.signal?.removeEventListener("abort", abort),
      { once: true },
    );
    request.send(form);
  });
}

export async function createYoutubeJob(
  sourceUrl: string,
  signal?: AbortSignal,
): Promise<JobResponse> {
  const form = new FormData();
  form.append(config.youtubeUrlFieldName, sourceUrl);
  return requestJson<JobResponse>(config.endpoints.createJob, {
    method: "POST",
    body: form,
    signal,
  });
}

export async function getJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResponse> {
  return requestJson<JobResponse>(config.endpoints.getJob(jobId), {
    signal,
    cache: "no-store",
  });
}

export async function getLibrary(signal?: AbortSignal): Promise<LibraryResponse> {
  return requestJson<LibraryResponse>(config.endpoints.library, {
    signal,
    cache: "no-store",
  });
}

export async function requestJson<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const timeout = new AbortController();
  const timer = window.setTimeout(
    () => timeout.abort("timeout"),
    config.requestTimeoutMs,
  );
  const abort = () => timeout.abort("cancelled");
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
      credentials: "include",
      signal: timeout.signal,
    });
    const raw = await response.text();
    const payload = parseJson<T>(raw, response.status);
    if (!response.ok) throw fromResponse(payload, response.status);
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timeout.signal.reason === "timeout") {
      throw new ApiError("A consulta excedeu o tempo limite.", {
        kind: "timeout",
        retryable: true,
      });
    }
    if (init.signal?.aborted) {
      throw new ApiError("Consulta cancelada.", {
        kind: "cancelled",
        retryable: false,
      });
    }
    throw new ApiError("A conexão com o servidor foi interrompida.", {
      kind: "network",
      details: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  } finally {
    window.clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
