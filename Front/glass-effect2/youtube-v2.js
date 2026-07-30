import { ApiError, fallbackDownloadUrl, getJob } from "./api.js";

const CONFIG = window.__AUDIO_SEPARATOR_CONFIG__;
const SESSION_KEY = "musicai.youtubeJob.v2";
const appView = document.querySelector("#app-view");
const workspaceHeader = document.querySelector(".workspace__header");

if (appView && workspaceHeader && CONFIG) {
  installYoutubeMode();
}

function installYoutubeMode() {
  let lastProgress = 0;
  let pollTimer = null;
  let pollGeneration = 0;

  const picker = document.createElement("div");
  picker.className = "source-picker";
  picker.setAttribute("role", "tablist");
  picker.setAttribute("aria-label", "Origem do áudio");
  picker.innerHTML = `
    <button class="source-picker__button is-active" type="button" role="tab"
      aria-selected="true" data-source-mode="file">
      <span class="iconify" data-icon="lucide:file-audio"></span> Arquivo
    </button>
    <button class="source-picker__button" type="button" role="tab"
      aria-selected="false" data-source-mode="youtube">
      <span class="iconify" data-icon="lucide:youtube"></span> YouTube
    </button>
  `;
  appView.before(picker);

  const youtubeView = document.createElement("div");
  youtubeView.id = "youtube-view";
  youtubeView.hidden = true;
  appView.after(youtubeView);

  picker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-source-mode]");
    if (button) setMode(button.dataset.sourceMode);
  });

  renderYoutubeForm();
  updatePageCopy();
  restoreYoutubeJob();
  window.Iconify?.scan?.(picker);

  function setMode(mode) {
    const youtube = mode === "youtube";
    appView.hidden = youtube;
    youtubeView.hidden = !youtube;
    for (const button of picker.querySelectorAll("[data-source-mode]")) {
      const active = button.dataset.sourceMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
  }

  function renderYoutubeForm(errorMessage = "") {
    stopPolling();
    lastProgress = 0;
    youtubeView.innerHTML = `
      <section class="youtube-source" aria-labelledby="youtube-source-title">
        <div class="youtube-source__heading">
          <span class="youtube-source__icon">
            <span class="iconify" data-icon="lucide:youtube"></span>
          </span>
          <h3 id="youtube-source-title">Cole o link de um vídeo</h3>
          <p>Nós cuidamos do download e preparamos cada faixa para você.</p>
        </div>
        <form class="youtube-source__form" data-youtube-form>
          <label class="sr-only" for="youtube-url">URL do YouTube</label>
          <input class="youtube-source__input" id="youtube-url" name="youtube_url"
            type="url" inputmode="url" autocomplete="url"
            placeholder="https://www.youtube.com/watch?v=..."
            aria-describedby="youtube-help" required maxlength="2048" />
          <button class="button button--primary" type="submit">
            <span class="iconify" data-icon="lucide:sparkles"></span> Separar
          </button>
        </form>
        <small class="youtube-source__help" id="youtube-help">
          Um vídeo por vez · o processamento continua no servidor
        </small>
        ${errorMessage ? `<div class="message-card message-card--error" role="alert">${escapeHtml(errorMessage)}</div>` : ""}
      </section>
    `;
    youtubeView.querySelector("[data-youtube-form]").addEventListener(
      "submit",
      submitYoutube,
    );
    window.Iconify?.scan?.(youtubeView);
  }

  async function submitYoutube(event) {
    event.preventDefault();
    const sourceUrl = event.currentTarget.elements.youtube_url.value.trim();
    if (!isYoutubeUrl(sourceUrl)) {
      renderYoutubeForm("Informe uma URL válida de um vídeo do YouTube.");
      youtubeView.querySelector("#youtube-url")?.focus();
      return;
    }

    lastProgress = 1;
    renderProgress(
      "Preparando seu pedido",
      "Validando o link e reservando seu lugar na fila.",
      null,
      1,
    );
    try {
      const form = new FormData();
      form.append(CONFIG.youtubeUrlFieldName, sourceUrl);
      const response = await fetch(apiUrl(CONFIG.endpoints.createJob), {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ||
            `O servidor respondeu com HTTP ${response.status}.`,
        );
      }
      if (!payload.job_id) {
        throw new Error("O servidor não retornou o identificador do job.");
      }
      persistYoutubeJob(payload.job_id);
      startPolling(payload.job_id);
    } catch (error) {
      renderYoutubeError(error.message);
    }
  }

  function startPolling(jobId) {
    stopPolling();
    const generation = ++pollGeneration;
    pollYoutubeJob(jobId, generation, 0);
  }

  async function pollYoutubeJob(jobId, generation, failureCount) {
    if (generation !== pollGeneration) return;
    try {
      const job = await getJob(jobId);
      if (generation !== pollGeneration) return;

      const measured = Number(job.raw?.progress_percent);
      if (Number.isFinite(measured)) {
        lastProgress = Math.max(lastProgress, Math.min(100, measured));
      }

      if (job.status === "completed") {
        lastProgress = 100;
        renderYoutubeComplete(
          job.downloadUrl || fallbackDownloadUrl(jobId),
          job.elapsedSeconds,
        );
        return;
      }
      if (job.status === "failed") {
        clearYoutubeJob();
        renderYoutubeError(
          job.error?.message ||
            job.message ||
            "Não foi possível concluir esse processamento.",
          jobId,
        );
        return;
      }

      renderProgress(
        progressTitle(job.status, lastProgress),
        job.message || friendlyFallback(lastProgress),
        jobId,
        lastProgress,
      );
      schedulePoll(
        jobId,
        generation,
        0,
        CONFIG.initialPollDelayMs,
      );
    } catch (error) {
      if (generation !== pollGeneration) return;
      if (error instanceof ApiError && error.status === 404) {
        clearYoutubeJob();
        renderYoutubeError(
          "Esse processamento não está mais disponível no servidor.",
        );
        return;
      }

      const failures = failureCount + 1;
      const delay = Math.min(
        CONFIG.maxPollDelayMs,
        CONFIG.initialPollDelayMs * 2 ** Math.min(failures - 1, 4),
      );
      renderProgress(
        "Seu áudio continua sendo processado",
        "A conexão oscilou, mas o trabalho segue no servidor. Vamos consultar novamente.",
        jobId,
        lastProgress,
        true,
      );
      schedulePoll(jobId, generation, failures, delay);
    }
  }

  function schedulePoll(jobId, generation, failures, delay) {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(
      () => pollYoutubeJob(jobId, generation, failures),
      delay,
    );
  }

  function stopPolling() {
    pollGeneration += 1;
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function renderProgress(
    title,
    message,
    jobId,
    progress,
    reconnecting = false,
  ) {
    const percent = Math.max(0, Math.min(100, Math.round(progress || 0)));
    youtubeView.innerHTML = `
      <div class="youtube-job" role="status" aria-live="polite">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="youtube-job__progress">
          <div class="youtube-job__progress-meta">
            <span class="youtube-job__stage">
              <i class="youtube-job__stage-dot" aria-hidden="true"></i>
              ${escapeHtml(stageLabel(percent))}
            </span>
            <strong>${percent}%</strong>
          </div>
          <div class="youtube-job__track" role="progressbar"
            aria-label="Progresso do processamento"
            aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
            <div class="youtube-job__bar" style="--job-progress: ${percent}%"></div>
          </div>
        </div>
        ${reconnecting ? `
          <div class="youtube-job__connection">
            <span class="iconify" data-icon="lucide:wifi-off"></span>
            Reconectando automaticamente — não é preciso reenviar o link.
          </div>
        ` : ""}
        ${jobId ? `<small class="youtube-source__help">Job ${escapeHtml(jobId.slice(0, 8))}…</small>` : ""}
      </div>
    `;
    window.Iconify?.scan?.(youtubeView);
  }

  function renderYoutubeComplete(downloadUrl, elapsedSeconds) {
    const duration = Number.isFinite(elapsedSeconds)
      ? ` em ${formatDuration(elapsedSeconds)}`
      : "";
    youtubeView.innerHTML = `
      <div class="youtube-job" role="status">
        <span class="youtube-source__icon">
          <span class="iconify" data-icon="lucide:circle-check"></span>
        </span>
        <h3>Suas faixas estão prontas</h3>
        <p>Finalizamos tudo${duration}. Agora é só baixar e explorar cada instrumento.</p>
        <div class="youtube-job__progress">
          <div class="youtube-job__progress-meta">
            <span>Processamento concluído</span><strong>100%</strong>
          </div>
          <div class="youtube-job__track">
            <div class="youtube-job__bar" style="--job-progress: 100%"></div>
          </div>
        </div>
        <a class="button button--primary" href="${escapeHtml(downloadUrl)}">
          <span class="iconify" data-icon="lucide:download"></span> Baixar ZIP
        </a>
        <button class="button button--secondary" type="button" data-new-youtube>
          Processar outro link
        </button>
      </div>
    `;
    youtubeView.querySelector("[data-new-youtube]").addEventListener(
      "click",
      newYoutubeJob,
    );
    window.Iconify?.scan?.(youtubeView);
  }

  function renderYoutubeError(message, jobId = null) {
    stopPolling();
    youtubeView.innerHTML = `
      <div class="youtube-job" role="alert">
        <span class="youtube-source__icon">
          <span class="iconify" data-icon="lucide:circle-alert"></span>
        </span>
        <h3>Não conseguimos concluir dessa vez</h3>
        <p>${escapeHtml(message)}</p>
        ${jobId ? `<small class="youtube-source__help">Job ${escapeHtml(jobId.slice(0, 8))}…</small>` : ""}
        <button class="button button--primary" type="button" data-new-youtube>
          Tentar outro link
        </button>
      </div>
    `;
    youtubeView.querySelector("[data-new-youtube]").addEventListener(
      "click",
      newYoutubeJob,
    );
    window.Iconify?.scan?.(youtubeView);
  }

  function newYoutubeJob() {
    clearYoutubeJob();
    renderYoutubeForm();
  }

  function persistYoutubeJob(jobId) {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ jobId, savedAt: new Date().toISOString() }),
      );
    } catch {
      // Polling still works in the current page when storage is unavailable.
    }
  }

  function clearYoutubeJob() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // No user action is required.
    }
  }

  function restoreYoutubeJob() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!saved?.jobId) return;
      setMode("youtube");
      renderProgress(
        "Retomando o acompanhamento",
        "Consultando o andamento salvo neste navegador.",
        String(saved.jobId),
        lastProgress,
      );
      startPolling(String(saved.jobId));
    } catch {
      clearYoutubeJob();
    }
  }
}

function progressTitle(status, progress) {
  if (status === "queued") return "Tudo pronto para começar";
  if (status === "packaging" || progress >= 92) return "Preparando seu download";
  if (progress < 30) return "Trazendo o áudio do vídeo";
  if (progress < 70) return "Descobrindo cada instrumento";
  return "Seu resultado está quase pronto";
}

function stageLabel(progress) {
  if (progress < 5) return "Na fila";
  if (progress < 30) return "Preparando o áudio";
  if (progress < 92) return "Separando as faixas";
  if (progress < 100) return "Organizando o ZIP";
  return "Concluído";
}

function friendlyFallback(progress) {
  if (progress < 30) return "Buscando a melhor versão do áudio para você.";
  if (progress < 60) return "Reconhecendo os detalhes da música.";
  if (progress < 92) return "Dando forma a cada faixa separada.";
  return "Organizando tudo para o download.";
}

function apiUrl(path) {
  const base = String(CONFIG.apiBaseUrl || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

function isYoutubeUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]
        .includes(url.hostname.toLowerCase()) &&
      url.pathname !== "/"
    );
  } catch {
    return false;
  }
}

function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} segundos`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes} min ${String(remainder).padStart(2, "0")} s`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updatePageCopy() {
  const lead = document.querySelector(".hero__lead");
  if (lead) {
    lead.textContent =
      "Envie um MP3 ou WAV, ou cole um link do YouTube, e receba voz, bateria, baixo, guitarra, piano e outros em um único ZIP.";
  }
  const firstHowCard = document.querySelector(".how-card");
  const firstTitle = firstHowCard?.querySelector("h3");
  const firstText = firstHowCard?.querySelector("p");
  if (firstTitle) firstTitle.textContent = "Escolha a origem";
  if (firstText) {
    firstText.textContent =
      "Envie um arquivo MP3/WAV ou cole a URL de um vídeo do YouTube.";
  }
}

