const CONFIG = window.__AUDIO_SEPARATOR_CONFIG__;

if (!CONFIG) {
  throw new Error("Configuração da API não foi carregada.");
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = options.kind ?? "unknown";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.details = options.details ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  const base = String(CONFIG.apiBaseUrl ?? "").replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function parseJsonSafely(raw, status) {
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ApiError("O servidor retornou uma resposta inválida.", {
      kind: "invalid_response",
      status,
      details: error.message,
      retryable: status >= 500,
    });
  }
}

function errorFromPayload(payload, status) {
  const serverError = payload?.error;
  const message =
    serverError?.message ??
    payload?.detail ??
    payload?.message ??
    `O servidor respondeu com status ${status}.`;

  return new ApiError(message, {
    kind: status >= 500 ? "server" : "http",
    status,
    code: serverError?.code ?? null,
    details: serverError?.details ?? null,
    retryable: status === 408 || status === 429 || status >= 500,
  });
}

function normalizeJob(payload) {
  const jobId = payload?.job_id ?? payload?.id;
  const status = String(payload?.status ?? "unknown").toLowerCase();

  return {
    jobId: jobId ? String(jobId) : null,
    status,
    message: typeof payload?.message === "string" ? payload.message : null,
    downloadUrl:
      typeof payload?.download_url === "string"
        ? resolveDownloadUrl(payload.download_url)
        : null,
    error: payload?.error ?? null,
    elapsedSeconds:
      Number.isFinite(payload?.elapsed_seconds)
        ? Number(payload.elapsed_seconds)
        : null,
    stems: Array.isArray(payload?.stems) ? payload.stems : null,
    raw: payload,
  };
}

export function resolveDownloadUrl(downloadUrl) {
  if (!downloadUrl) return null;
  return buildUrl(downloadUrl);
}

export function fallbackDownloadUrl(jobId) {
  return buildUrl(CONFIG.endpoints.downloadJob(jobId));
}

export function createJob(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.append(CONFIG.uploadFieldName, file, file.name);

    request.open("POST", buildUrl(CONFIG.endpoints.createJob));
    request.responseType = "text";
    request.timeout = CONFIG.uploadTimeoutMs;
    request.setRequestHeader("Accept", "application/json");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        });
      }
    });

    request.addEventListener("load", () => {
      try {
        const payload = parseJsonSafely(request.responseText, request.status);
        if (request.status < 200 || request.status >= 300) {
          reject(errorFromPayload(payload, request.status));
          return;
        }

        const job = normalizeJob(payload);
        if (!job.jobId) {
          reject(
            new ApiError("O servidor não retornou um identificador de job.", {
              kind: "invalid_response",
              status: request.status,
              details: request.responseText,
            }),
          );
          return;
        }
        resolve(job);
      } catch (error) {
        reject(error);
      }
    });

    request.addEventListener("error", () => {
      reject(
        new ApiError("Não foi possível enviar o arquivo. Verifique sua conexão.", {
          kind: "network",
          retryable: true,
        }),
      );
    });

    request.addEventListener("timeout", () => {
      reject(
        new ApiError("O envio excedeu o tempo limite.", {
          kind: "timeout",
          retryable: true,
        }),
      );
    });

    request.addEventListener("abort", () => {
      reject(
        new ApiError("O envio foi cancelado.", {
          kind: "cancelled",
          retryable: true,
        }),
      );
    });

    const abortHandler = () => request.abort();
    signal?.addEventListener("abort", abortHandler, { once: true });
    request.addEventListener(
      "loadend",
      () => signal?.removeEventListener("abort", abortHandler),
      { once: true },
    );

    request.send(formData);
  });
}

export async function getJob(jobId, { signal } = {}) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(
    () => timeoutController.abort("timeout"),
    CONFIG.requestTimeoutMs,
  );

  const abortHandler = () => timeoutController.abort("cancelled");
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await fetch(buildUrl(CONFIG.endpoints.getJob(jobId)), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: timeoutController.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    const payload = parseJsonSafely(raw, response.status);

    if (!response.ok) {
      throw errorFromPayload(payload, response.status);
    }

    const job = normalizeJob(payload);
    if (!job.jobId) job.jobId = jobId;
    return job;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (timeoutController.signal.reason === "timeout") {
      throw new ApiError("A consulta de status excedeu o tempo limite.", {
        kind: "timeout",
        retryable: true,
      });
    }

    if (signal?.aborted) {
      throw new ApiError("Consulta cancelada.", {
        kind: "cancelled",
        retryable: false,
      });
    }

    throw new ApiError("A conexão com o servidor foi interrompida.", {
      kind: "network",
      details: error.message,
      retryable: true,
    });
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}
