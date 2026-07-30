import {
  ApiError,
  createJob,
  fallbackDownloadUrl,
  getJob,
} from "./api.js";

const CONFIG = window.__AUDIO_SEPARATOR_CONFIG__;
const SESSION_KEY = "stemlab.activeJob.v1";
const TERMINAL_PHASES = new Set(["completed", "failed"]);
const ACTIVE_PHASES = new Set([
  "uploading",
  "queued",
  "processing",
  "packaging",
  "connection_lost",
]);
const ACCEPTED_EXTENSIONS = new Set(["mp3", "wav"]);
const ACCEPTED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);

const PHASE_LABELS = Object.freeze({
  idle: "Novo processamento",
  file_selected: "Arquivo pronto",
  uploading: "Enviando arquivo",
  queued: "Job criado",
  processing: "Separação em andamento",
  packaging: "Preparando o download",
  completed: "Processamento concluído",
  failed: "Ação necessária",
  connection_lost: "Reconectando",
});

const SERVER_STATUS_MAP = Object.freeze({
  pending: "queued",
  queued: "queued",
  accepted: "queued",
  processing: "processing",
  running: "processing",
  separating: "processing",
  packaging: "packaging",
  zipping: "packaging",
  finalizing: "packaging",
  completed: "completed",
  complete: "completed",
  succeeded: "completed",
  done: "completed",
  failed: "failed",
  error: "failed",
  cancelled: "failed",
  canceled: "failed",
});

const PROCESSING_STEPS = Object.freeze([
  "Áudio recebido",
  "Preparando processamento",
  "Separando instrumentos",
  "Organizando arquivos",
  "Criando pacote ZIP",
  "Finalizando",
]);

const STEMS = Object.freeze([
  ["mic-2", "Voz"],
  ["drum", "Bateria"],
  ["music-2", "Baixo"],
  ["guitar", "Guitarra"],
  ["piano", "Piano"],
  ["sparkles", "Outros"],
]);

const appView = document.querySelector("#app-view");
const stateLabel = document.querySelector("#state-label");
const announcer = document.querySelector("#status-announcer");
const toastRegion = document.querySelector("#toast-region");
const confirmationDialog = document.querySelector("#confirmation-dialog");
const devSwitcher = document.querySelector("#dev-state-switcher");
const cursor = document.querySelector("#cursor");

let state = {
  phase: "idle",
  file: null,
  fileMeta: null,
  validationError: null,
  uploadProgress: 0,
  uploadedBytes: 0,
  jobId: null,
  jobMessage: null,
  downloadUrl: null,
  elapsedSeconds: null,
  error: null,
  networkFailures: 0,
};

let uploadController = null;
let pollController = null;
let pollTimer = null;
let pollGeneration = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes} min ${remainder.toString().padStart(2, "0")} s`;
}

function getFileMeta() {
  if (state.file) {
    return {
      name: state.file.name,
      size: state.file.size,
      type: state.file.type,
    };
  }
  return state.fileMeta;
}

function setState(patch, announcement = null) {
  state = { ...state, ...patch };
  render();
  if (announcement) announce(announcement);
}

function announce(message) {
  announcer.textContent = "";
  window.requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function refreshIcons() {
  window.Iconify?.scan?.(appView);
}

function render() {
  stateLabel.textContent = PHASE_LABELS[state.phase] ?? "Status do processamento";

  switch (state.phase) {
    case "idle":
      appView.innerHTML = renderIdle();
      break;
    case "file_selected":
      appView.innerHTML = renderSelectedFile();
      break;
    case "uploading":
      appView.innerHTML = renderUploading();
      break;
    case "queued":
    case "processing":
    case "packaging":
      appView.innerHTML = renderProcessing();
      break;
    case "completed":
      appView.innerHTML = renderCompleted();
      break;
    case "connection_lost":
      appView.innerHTML = renderConnectionLost();
      break;
    case "failed":
      appView.innerHTML = renderError();
      break;
    default:
      appView.innerHTML = renderIdle();
  }

  refreshIcons();
}

function fileInputMarkup(id = "audio-file") {
  return `
    <input
      class="file-input"
      id="${id}"
      data-role="file-input"
      type="file"
      accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
      aria-describedby="file-help"
    />
  `;
}

function renderIdle() {
  const validationMessage = state.validationError
    ? `
      <div class="message-card message-card--error" role="alert">
        <span class="iconify" data-icon="lucide:circle-alert"></span>
        <span>${escapeHtml(state.validationError)}</span>
      </div>
    `
    : "";

  return `
    <div
      class="dropzone cursor-hover"
      data-role="dropzone"
      tabindex="0"
      role="button"
      aria-label="Selecionar ou arrastar um arquivo MP3 ou WAV"
    >
      <div>
        <span class="dropzone__icon">
          <span class="iconify" data-icon="lucide:upload-cloud"></span>
        </span>
        <h3>Arraste seu áudio para cá</h3>
        <p>ou escolha um arquivo no seu dispositivo</p>
        ${fileInputMarkup()}
        <button class="button button--primary cursor-hover" type="button" data-action="choose-file">
          <span class="iconify" data-icon="lucide:folder-open"></span>
          Selecionar arquivo
        </button>
        <small class="dropzone__meta" id="file-help">
          MP3 ou WAV · até ${formatBytes(CONFIG.maxFileSizeBytes)} · 1 arquivo por vez
        </small>
      </div>
    </div>
    ${validationMessage}
  `;
}

function renderSelectedFile() {
  const file = getFileMeta();
  return `
    <div class="selected-file">
      <div class="file-card">
        <span class="file-card__icon">
          <span class="iconify" data-icon="lucide:file-audio-2"></span>
        </span>
        <div class="file-card__info">
          <strong title="${escapeHtml(file?.name)}">${escapeHtml(file?.name)}</strong>
          <span>${escapeHtml(file?.type || "áudio")} · ${formatBytes(file?.size)}</span>
        </div>
        <button
          class="icon-button cursor-hover"
          type="button"
          data-action="remove-file"
          aria-label="Remover arquivo selecionado"
        >
          <span class="iconify" data-icon="lucide:trash-2"></span>
        </button>
      </div>
      <div class="validation-ok" role="status">
        <span class="iconify" data-icon="lucide:circle-check"></span>
        <span>Arquivo validado e pronto para envio.</span>
      </div>
      ${fileInputMarkup("replace-audio-file")}
      <div class="button-row">
        <button class="button button--secondary cursor-hover" type="button" data-action="replace-file">
          <span class="iconify" data-icon="lucide:replace"></span>
          Substituir
        </button>
        <button class="button button--primary cursor-hover" type="button" data-action="start-upload">
          <span class="iconify" data-icon="lucide:sparkles"></span>
          Separar instrumentos
        </button>
      </div>
    </div>
  `;
}

function renderUploading() {
  const file = getFileMeta();
  return `
    <div class="upload-state">
      <div class="state-heading">
        <span class="state-icon">
          <span class="iconify" data-icon="lucide:cloud-upload"></span>
        </span>
        <h3>Enviando seu áudio</h3>
        <p>Não feche esta página durante o envio. O processamento começará assim que o servidor confirmar o recebimento.</p>
      </div>
      <div class="progress-card">
        <div class="progress-card__meta">
          <strong title="${escapeHtml(file?.name)}">${escapeHtml(file?.name)}</strong>
          <span>${state.uploadProgress}%</span>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          aria-label="Progresso do upload"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${state.uploadProgress}"
        >
          <div class="progress-bar" style="--progress: ${state.uploadProgress}%"></div>
        </div>
        <div class="progress-card__meta" style="margin: 10px 0 0">
          <span>${formatBytes(state.uploadedBytes)} enviados</span>
          <span>${formatBytes(file?.size)}</span>
        </div>
      </div>
      <div class="button-row">
        <button class="button button--danger cursor-hover" type="button" data-action="cancel-upload">
          <span class="iconify" data-icon="lucide:x"></span>
          Cancelar envio
        </button>
      </div>
    </div>
  `;
}

function currentStepIndex() {
  if (state.phase === "queued") return 1;
  if (state.phase === "processing") return 2;
  if (state.phase === "packaging") return 4;
  if (state.phase === "completed") return PROCESSING_STEPS.length;
  return 0;
}

function renderProcessingSteps() {
  const activeIndex = currentStepIndex();

  return PROCESSING_STEPS.map((label, index) => {
    const isComplete = index < activeIndex;
    const isActive = index === activeIndex;
    const className = isComplete
      ? "is-complete"
      : isActive
        ? "is-active"
        : "";
    const markerIcon = isComplete
      ? '<span class="iconify" data-icon="lucide:check"></span>'
      : String(index + 1).padStart(2, "0");
    const statusText = isComplete ? "Confirmado" : isActive ? "Em andamento" : "";

    return `
      <li class="processing-step ${className}">
        <span class="processing-step__marker">${markerIcon}</span>
        <span>${label}</span>
        <span class="processing-step__status">${statusText}</span>
      </li>
    `;
  }).join("");
}

function renderProcessing() {
  const titleByPhase = {
    queued: "Áudio recebido",
    processing: "Separando instrumentos",
    packaging: "Montando seu pacote",
  };
  const descriptionByPhase = {
    queued: "Seu job está na fila e será iniciado assim que houver capacidade disponível.",
    processing: "O Demucs está analisando o áudio. O tempo varia conforme a duração do arquivo e a carga do servidor.",
    packaging: "As faixas estão sendo organizadas e compactadas para download.",
  };

  return `
    <div class="processing-state">
      <div class="state-heading">
        <span class="state-icon">
          <span class="iconify" data-icon="lucide:audio-waveform"></span>
        </span>
        <h3>${titleByPhase[state.phase]}</h3>
        <p>${escapeHtml(state.jobMessage || descriptionByPhase[state.phase])}</p>
      </div>
      <div class="job-reference">
        <span class="iconify" data-icon="lucide:fingerprint"></span>
        Job ${escapeHtml(shortJobId(state.jobId))}
      </div>
      <div class="progress-card">
        <div class="progress-card__meta">
          <strong>Processamento no servidor</strong>
          <span>Tempo variável</span>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          aria-label="Processamento em andamento, percentual não informado pelo servidor"
        >
          <div class="indeterminate"></div>
        </div>
        <ol class="processing-steps">
          ${renderProcessingSteps()}
        </ol>
      </div>
    </div>
  `;
}

function renderCompleted() {
  const file = getFileMeta();
  const duration = formatDuration(state.elapsedSeconds);
  const downloadUrl = state.downloadUrl || fallbackDownloadUrl(state.jobId);
  const miniStems = STEMS.map(
    ([icon, name]) => `
      <span class="mini-stem">
        <span class="iconify" data-icon="lucide:${icon}"></span>
        ${name}
      </span>
    `,
  ).join("");

  return `
    <div class="result-state">
      <div class="state-heading">
        <span class="state-icon">
          <span class="iconify" data-icon="lucide:circle-check-big"></span>
        </span>
        <h3>Suas faixas estão prontas</h3>
        <p>A separação foi concluída e os seis stems foram organizados em um pacote ZIP.</p>
      </div>
      <div class="result-summary">
        <div>
          <strong title="${escapeHtml(file?.name)}">${escapeHtml(file?.name || "Áudio processado")}</strong>
          <span>Job ${escapeHtml(shortJobId(state.jobId))}${duration ? ` · ${duration}` : ""}</span>
        </div>
        <span class="result-summary__count">6 stems</span>
      </div>
      <div class="mini-stems" aria-label="Faixas incluídas">
        ${miniStems}
      </div>
      <a
        class="button button--primary button--full cursor-hover"
        href="${escapeHtml(downloadUrl)}"
        download
        data-action="download"
      >
        <span class="iconify" data-icon="lucide:download"></span>
        Baixar pacote ZIP
      </a>
      <div class="button-row">
        <button class="button button--secondary cursor-hover button--full" type="button" data-action="new-file">
          <span class="iconify" data-icon="lucide:refresh-cw"></span>
          Processar outro arquivo
        </button>
      </div>
    </div>
  `;
}

function renderConnectionLost() {
  const nextAttempt = Math.min(
    CONFIG.maxPollDelayMs,
    CONFIG.initialPollDelayMs * 2 ** Math.max(0, state.networkFailures - 1),
  );
  return `
    <div class="error-state">
      <div class="state-heading">
        <span class="state-icon" style="color: var(--color-warning)">
          <span class="iconify" data-icon="lucide:wifi-off"></span>
        </span>
        <h3>Conexão interrompida</h3>
        <p>O processamento pode continuar no servidor. Manteremos o job e tentaremos consultar o status novamente.</p>
      </div>
      <div class="message-card message-card--warning" role="status">
        <span class="iconify" data-icon="lucide:rotate-cw"></span>
        <span>Nova tentativa automática em até ${Math.ceil(nextAttempt / 1000)} segundos.</span>
      </div>
      <div class="job-reference" style="margin-top: 18px">
        <span class="iconify" data-icon="lucide:fingerprint"></span>
        Job ${escapeHtml(shortJobId(state.jobId))}
      </div>
      <div class="button-row">
        <button class="button button--secondary cursor-hover" type="button" data-action="new-file">Novo arquivo</button>
        <button class="button button--primary cursor-hover" type="button" data-action="retry-status">
          <span class="iconify" data-icon="lucide:refresh-cw"></span>
          Consultar agora
        </button>
      </div>
    </div>
  `;
}

function renderError() {
  const error = state.error ?? {
    title: "Não foi possível concluir",
    message: "Tente novamente em alguns instantes.",
    details: null,
    retryable: true,
  };
  const details = error.details
    ? `
      <details class="error-details">
        <summary>Ver detalhes técnicos</summary>
        <pre>${escapeHtml(error.details)}</pre>
      </details>
    `
    : "";
  const retryAction = state.jobId ? "retry-status" : "retry-upload";
  const canRetryUpload = Boolean(state.file);

  return `
    <div class="error-state">
      <div class="state-heading">
        <span class="state-icon">
          <span class="iconify" data-icon="lucide:circle-alert"></span>
        </span>
        <h3>${escapeHtml(error.title)}</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>
      ${details}
      <div class="button-row">
        <button class="button button--secondary cursor-hover" type="button" data-action="new-file">
          Escolher outro arquivo
        </button>
        ${
          error.retryable && (state.jobId || canRetryUpload)
            ? `
              <button class="button button--primary cursor-hover" type="button" data-action="${retryAction}">
                <span class="iconify" data-icon="lucide:refresh-cw"></span>
                Tentar novamente
              </button>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function shortJobId(jobId) {
  if (!jobId) return "aguardando";
  return jobId.length > 12 ? `${jobId.slice(0, 8)}…` : jobId;
}

function validateFiles(fileList) {
  const files = Array.from(fileList ?? []);

  if (files.length === 0) {
    return { error: "Selecione um arquivo MP3 ou WAV." };
  }
  if (files.length > 1) {
    return { error: "Selecione apenas um arquivo." };
  }

  const [file] = files;
  const extension = file.name.includes(".")
    ? file.name.split(".").pop().toLowerCase()
    : "";

  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    return { error: "Este formato não é suportado. Use um arquivo MP3 ou WAV." };
  }
  if (file.type && !ACCEPTED_MIME_TYPES.has(file.type.toLowerCase())) {
    return { error: "O tipo de áudio informado pelo arquivo não é suportado." };
  }
  if (file.size === 0) {
    return { error: "O arquivo está vazio." };
  }
  if (file.size > CONFIG.maxFileSizeBytes) {
    return {
      error: `O arquivo excede o limite permitido de ${formatBytes(CONFIG.maxFileSizeBytes)}.`,
    };
  }
  if (file.name.length > 180) {
    return { error: "O nome do arquivo é muito longo. Use até 180 caracteres." };
  }

  return { file };
}

function handleFiles(fileList) {
  const result = validateFiles(fileList);
  if (result.error) {
    setState(
      {
        phase: "idle",
        file: null,
        fileMeta: null,
        validationError: result.error,
      },
      result.error,
    );
    return;
  }

  setState(
    {
      phase: "file_selected",
      file: result.file,
      fileMeta: {
        name: result.file.name,
        size: result.file.size,
        type: result.file.type,
      },
      validationError: null,
      error: null,
    },
    `Arquivo ${result.file.name} selecionado e validado.`,
  );
}

async function startUpload() {
  if (!state.file) {
    setState(
      { phase: "idle", validationError: "Selecione o arquivo novamente." },
      "O arquivo precisa ser selecionado novamente.",
    );
    return;
  }

  stopPolling();
  uploadController = new AbortController();
  setState(
    {
      phase: "uploading",
      uploadProgress: 0,
      uploadedBytes: 0,
      error: null,
      jobId: null,
    },
    "Upload iniciado.",
  );

  try {
    const job = await createJob(state.file, {
      signal: uploadController.signal,
      onProgress: ({ percent, loaded }) => {
        setState({ uploadProgress: percent, uploadedBytes: loaded });
      },
    });

    const fileMeta = getFileMeta();
    setState(
      {
        phase: "queued",
        jobId: job.jobId,
        jobMessage: job.message,
        uploadProgress: 100,
        networkFailures: 0,
      },
      "Arquivo recebido. Job criado e aguardando processamento.",
    );
    persistJob(job.jobId, fileMeta);
    startPolling(job.jobId);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "cancelled") {
      setState({ phase: "file_selected" }, "Upload cancelado.");
      showToast("Envio cancelado. Seu arquivo continua selecionado.");
      return;
    }

    setState(
      {
        phase: "failed",
        error: presentError(error, "upload"),
      },
      "Falha no envio do arquivo.",
    );
  } finally {
    uploadController = null;
  }
}

function applyJob(job) {
  const mappedPhase = SERVER_STATUS_MAP[job.status];

  if (!mappedPhase) {
    setState(
      {
        phase: state.phase === "connection_lost" ? "processing" : state.phase,
        jobMessage:
          job.message ||
          `O servidor informou o estado “${job.status}”. Continuaremos acompanhando com segurança.`,
        networkFailures: 0,
      },
      "Status do processamento atualizado.",
    );
    return false;
  }

  if (mappedPhase === "failed") {
    stopPolling();
    setState(
      {
        phase: "failed",
        jobMessage: job.message,
        error: {
          title: "A separação não foi concluída",
          message:
            job.error?.message ||
            job.message ||
            "O servidor encontrou um problema ao processar o áudio.",
          details: job.error?.code
            ? `Código: ${job.error.code}`
            : "Falha informada pelo serviço de processamento.",
          retryable: true,
        },
      },
      "O servidor informou uma falha no processamento.",
    );
    persistJob(job.jobId, getFileMeta());
    return true;
  }

  if (mappedPhase === "completed") {
    stopPolling();
    setState(
      {
        phase: "completed",
        jobMessage: job.message,
        downloadUrl: job.downloadUrl || fallbackDownloadUrl(job.jobId),
        elapsedSeconds: job.elapsedSeconds,
        networkFailures: 0,
      },
      "Processamento concluído. O pacote ZIP está disponível para download.",
    );
    persistJob(job.jobId, getFileMeta());
    return true;
  }

  setState(
    {
      phase: mappedPhase,
      jobMessage: job.message,
      networkFailures: 0,
    },
    mappedPhase === "queued"
      ? "Job aguardando processamento."
      : mappedPhase === "packaging"
        ? "As faixas estão sendo compactadas."
        : "Separação de instrumentos em andamento.",
  );
  return false;
}

function startPolling(jobId, { immediate = true } = {}) {
  stopPolling();
  pollGeneration += 1;
  const generation = pollGeneration;
  pollController = new AbortController();
  schedulePoll(jobId, generation, immediate ? 0 : CONFIG.initialPollDelayMs);
}

function schedulePoll(jobId, generation, delay) {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(
    () => pollOnce(jobId, generation),
    Math.max(0, delay),
  );
}

async function pollOnce(jobId, generation) {
  if (generation !== pollGeneration || !pollController) return;

  try {
    const job = await getJob(jobId, { signal: pollController.signal });
    if (generation !== pollGeneration) return;

    const isTerminal = applyJob(job);
    if (!isTerminal) {
      schedulePoll(jobId, generation, CONFIG.initialPollDelayMs);
    }
  } catch (error) {
    if (generation !== pollGeneration) return;
    if (error instanceof ApiError && error.kind === "cancelled") return;

    if (error instanceof ApiError && error.status === 404) {
      clearPersistedJob();
      stopPolling();
      setState(
        {
          phase: "failed",
          jobId: null,
          error: {
            title: "Job não encontrado",
            message:
              "O servidor não reconhece mais este processamento. Você pode iniciar um novo envio.",
            details: `HTTP 404 · ${error.message}`,
            retryable: false,
          },
        },
        "O job salvo não foi encontrado.",
      );
      return;
    }

    const failures = state.networkFailures + 1;
    const delay = Math.min(
      CONFIG.maxPollDelayMs,
      CONFIG.initialPollDelayMs * 2 ** Math.max(0, failures - 1),
    );

    setState(
      {
        phase: failures >= 2 ? "connection_lost" : state.phase,
        networkFailures: failures,
        error: presentError(error, "status"),
      },
      failures >= 2
        ? "Conexão interrompida. O job continua salvo."
        : "Falha temporária ao consultar o status.",
    );
    schedulePoll(jobId, generation, delay);
  }
}

function stopPolling() {
  pollGeneration += 1;
  window.clearTimeout(pollTimer);
  pollTimer = null;
  pollController?.abort();
  pollController = null;
}

function presentError(error, context) {
  if (!(error instanceof ApiError)) {
    return {
      title: "Erro inesperado",
      message: "Não foi possível concluir esta etapa. Tente novamente.",
      details: error?.message ?? String(error),
      retryable: true,
    };
  }

  const titles = {
    network: "Sem conexão com o servidor",
    timeout: "O servidor demorou a responder",
    server: "Serviço temporariamente indisponível",
    http: context === "upload" ? "O arquivo não foi aceito" : "Consulta recusada",
    invalid_response: "Resposta inválida do servidor",
  };

  return {
    title: titles[error.kind] ?? "Não foi possível continuar",
    message: error.message,
    details: [
      error.status ? `HTTP ${error.status}` : null,
      error.code ? `Código ${error.code}` : null,
      error.details,
    ]
      .filter(Boolean)
      .join("\n"),
    retryable: error.retryable,
  };
}

function persistJob(jobId, fileMeta) {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        jobId,
        fileMeta,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    showToast("O navegador não permitiu salvar o acompanhamento deste job.");
  }
}

function clearPersistedJob() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage may be disabled; there is no user action required.
  }
}

function restorePersistedJob() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved?.jobId) {
      clearPersistedJob();
      return false;
    }

    state = {
      ...state,
      phase: "queued",
      jobId: String(saved.jobId),
      fileMeta: saved.fileMeta ?? null,
      jobMessage: "Retomando o acompanhamento do job salvo…",
    };
    render();
    announce("Acompanhamento do processamento restaurado.");
    startPolling(state.jobId);
    return true;
  } catch {
    clearPersistedJob();
    return false;
  }
}

function resetFlow() {
  uploadController?.abort();
  uploadController = null;
  stopPolling();
  clearPersistedJob();
  state = {
    phase: "idle",
    file: null,
    fileMeta: null,
    validationError: null,
    uploadProgress: 0,
    uploadedBytes: 0,
    jobId: null,
    jobMessage: null,
    downloadUrl: null,
    elapsedSeconds: null,
    error: null,
    networkFailures: 0,
  };
  render();
  announce("Pronto para selecionar um novo arquivo.");
  document.querySelector("#workspace")?.scrollIntoView({ behavior: "smooth" });
}

function requestNewFlow() {
  if (state.phase === "idle" || state.phase === "file_selected") {
    resetFlow();
    return;
  }

  if (typeof confirmationDialog.showModal === "function") {
    confirmationDialog.showModal();
  } else if (window.confirm("Encerrar o acompanhamento e processar outro arquivo?")) {
    resetFlow();
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="iconify" data-icon="lucide:info"></span>
    <p>${escapeHtml(message)}</p>
    <button type="button" aria-label="Fechar notificação">
      <span class="iconify" data-icon="lucide:x"></span>
    </button>
  `;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  toastRegion.append(toast);
  window.Iconify?.scan?.(toast);
  window.setTimeout(() => toast.remove(), 6000);
}

function chooseCurrentFileInput() {
  appView.querySelector('[data-role="file-input"]')?.click();
}

appView.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;

  const action = trigger.dataset.action;
  if (action === "choose-file" || action === "replace-file") {
    chooseCurrentFileInput();
  } else if (action === "remove-file") {
    setState(
      {
        phase: "idle",
        file: null,
        fileMeta: null,
        validationError: null,
      },
      "Arquivo removido.",
    );
  } else if (action === "start-upload") {
    startUpload();
  } else if (action === "cancel-upload") {
    uploadController?.abort();
  } else if (action === "retry-upload") {
    startUpload();
  } else if (action === "retry-status" && state.jobId) {
    setState(
      { phase: "queued", networkFailures: 0 },
      "Consultando o status novamente.",
    );
    startPolling(state.jobId);
  } else if (action === "new-file") {
    requestNewFlow();
  } else if (action === "download") {
    showToast("O download do pacote foi iniciado.");
  }
});

appView.addEventListener("change", (event) => {
  if (event.target.matches('[data-role="file-input"]')) {
    handleFiles(event.target.files);
  }
});

appView.addEventListener("keydown", (event) => {
  const dropzone = event.target.closest('[data-role="dropzone"]');
  if (dropzone && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    chooseCurrentFileInput();
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  appView.addEventListener(eventName, (event) => {
    const dropzone = event.target.closest('[data-role="dropzone"]');
    if (!dropzone) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropzone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  appView.addEventListener(eventName, (event) => {
    const dropzone = event.target.closest('[data-role="dropzone"]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    if (eventName === "drop") handleFiles(event.dataTransfer?.files);
  });
}

confirmationDialog.addEventListener("close", () => {
  if (confirmationDialog.returnValue === "confirm") resetFlow();
});

document.addEventListener("mousemove", (event) => {
  cursor.style.left = `${event.clientX}px`;
  cursor.style.top = `${event.clientY}px`;
});

document.addEventListener("mouseover", (event) => {
  if (event.target.closest("a, button, label, summary, [role='button']")) {
    cursor.classList.add("hovered");
  }
});

document.addEventListener("mouseout", (event) => {
  if (event.target.closest("a, button, label, summary, [role='button']")) {
    cursor.classList.remove("hovered");
  }
});

window.addEventListener("beforeunload", () => {
  uploadController?.abort();
  stopPolling();
});

function setupDevStateSwitcher() {
  const params = new URLSearchParams(window.location.search);
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", ""]);
  if (params.get("dev") !== "states" || !localHostnames.has(location.hostname)) {
    return;
  }

  const devStates = [
    ["idle", "Inicial"],
    ["file_selected", "Selecionado"],
    ["uploading", "Upload"],
    ["queued", "Fila"],
    ["processing", "Processando"],
    ["packaging", "Compactando"],
    ["completed", "Sucesso"],
    ["validation", "Erro validação"],
    ["connection_lost", "Erro rede"],
    ["failed", "Erro processo"],
  ];

  devSwitcher.hidden = false;
  devSwitcher.innerHTML = `
    <div class="dev-switcher__title">
      <span>Preview de estados</span>
      <span>Somente dev</span>
    </div>
    <div class="dev-switcher__buttons">
      ${devStates
        .map(
          ([phase, label]) =>
            `<button type="button" data-dev-phase="${phase}">${label}</button>`,
        )
        .join("")}
    </div>
  `;

  devSwitcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dev-phase]");
    if (!button) return;
    stopPolling();

    const demoFile = new File([new Uint8Array(2 * 1024 * 1024)], "solo-guitarra-demo.wav", {
      type: "audio/wav",
    });
    const common = {
      file: demoFile,
      fileMeta: { name: demoFile.name, size: demoFile.size, type: demoFile.type },
      jobId: "a84b25f1-demo-4f32-9012",
      jobMessage: null,
      uploadProgress: 43,
      uploadedBytes: Math.round(demoFile.size * 0.43),
      downloadUrl: "#download-demo",
      elapsedSeconds: 186,
      networkFailures: 3,
      validationError: null,
      error: null,
    };
    const phase = button.dataset.devPhase;

    if (phase === "validation") {
      setState({
        ...common,
        phase: "idle",
        file: null,
        fileMeta: null,
        validationError: "Este formato não é suportado. Use um arquivo MP3 ou WAV.",
      });
    } else if (phase === "failed") {
      setState({
        ...common,
        phase: "failed",
        error: {
          title: "A separação não foi concluída",
          message: "O servidor não conseguiu processar este arquivo de áudio.",
          details: "Código: PROCESSING_FAILED\nJob: a84b25f1-demo",
          retryable: true,
        },
      });
    } else {
      setState({ ...common, phase });
    }
  });
}

render();
setupDevStateSwitcher();
restorePersistedJob();
