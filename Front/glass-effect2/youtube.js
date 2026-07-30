import { fallbackDownloadUrl, getJob } from "./api.js";

const CONFIG = window.__AUDIO_SEPARATOR_CONFIG__;
const appView = document.querySelector("#app-view");
const workspaceHeader = document.querySelector(".workspace__header");

if (appView && workspaceHeader && CONFIG) {
  installYoutubeMode();
}

function installYoutubeMode() {
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
    if (!button) return;
    setMode(button.dataset.sourceMode);
  });

  renderYoutubeForm();
  updatePageCopy();
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
    youtubeView.innerHTML = `
      <section class="youtube-source" aria-labelledby="youtube-source-title">
        <div class="youtube-source__heading">
          <span class="youtube-source__icon">
            <span class="iconify" data-icon="lucide:youtube"></span>
          </span>
          <h3 id="youtube-source-title">Cole o link de um vídeo</h3>
          <p>O servidor baixa o melhor áudio disponível e inicia a separação.</p>
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
          Um vídeo por vez · playlists não são processadas
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
    const input = event.currentTarget.elements.youtube_url;
    const sourceUrl = input.value.trim();
    if (!isYoutubeUrl(sourceUrl)) {
      renderYoutubeForm("Informe uma URL válida de um vídeo do YouTube.");
      youtubeView.querySelector("#youtube-url")?.focus();
      return;
    }

    renderYoutubeJob(
      "Enviando o link",
      "A URL está sendo validada pelo servidor.",
    );
    try {
      const form = new FormData();
      form.append(CONFIG.youtubeUrlFieldName, sourceUrl);
      const response = await fetch(CONFIG.endpoints.createJob, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error?.message || `O servidor respondeu com HTTP ${response.status}.`,
        );
      }
      if (!payload.job_id) {
        throw new Error("O servidor não retornou o identificador do job.");
      }
      await pollYoutubeJob(payload.job_id);
    } catch (error) {
      renderYoutubeError(error.message);
    }
  }

  async function pollYoutubeJob(jobId) {
    try {
      const job = await getJob(jobId);
      if (job.status === "completed") {
        renderYoutubeComplete(
          job.downloadUrl || fallbackDownloadUrl(jobId),
          job.elapsedSeconds,
        );
        return;
      }
      if (job.status === "failed") {
        throw new Error(
          job.error?.message || job.message || "O processamento não foi concluído.",
        );
      }
      renderYoutubeJob(
        job.status === "packaging" ? "Criando o pacote ZIP" : "Processando o vídeo",
        job.message || "O job continua no servidor.",
        jobId,
      );
      window.setTimeout(() => pollYoutubeJob(jobId), CONFIG.initialPollDelayMs);
    } catch (error) {
      renderYoutubeError(error.message, jobId);
    }
  }

  function renderYoutubeJob(title, message, jobId = null) {
    youtubeView.innerHTML = `
      <div class="youtube-job" role="status" aria-live="polite">
        <span class="youtube-job__spinner" aria-hidden="true"></span>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${jobId ? `<small class="youtube-source__help">Job ${escapeHtml(jobId.slice(0, 8))}…</small>` : ""}
      </div>
    `;
  }

  function renderYoutubeComplete(downloadUrl, elapsedSeconds) {
    const duration = Number.isFinite(elapsedSeconds)
      ? ` em ${Math.round(elapsedSeconds)} segundos`
      : "";
    youtubeView.innerHTML = `
      <div class="youtube-job" role="status">
        <span class="youtube-source__icon">
          <span class="iconify" data-icon="lucide:circle-check"></span>
        </span>
        <h3>Seis stems prontos</h3>
        <p>O vídeo foi processado${duration}. Baixe voz, bateria, baixo, guitarra, piano e outros.</p>
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
      () => renderYoutubeForm(),
    );
    window.Iconify?.scan?.(youtubeView);
  }

  function renderYoutubeError(message, jobId = null) {
    youtubeView.innerHTML = `
      <div class="youtube-job" role="alert">
        <span class="youtube-source__icon">
          <span class="iconify" data-icon="lucide:circle-alert"></span>
        </span>
        <h3>Não foi possível processar o link</h3>
        <p>${escapeHtml(message)}</p>
        ${jobId ? `<small class="youtube-source__help">Job ${escapeHtml(jobId.slice(0, 8))}…</small>` : ""}
        <button class="button button--primary" type="button" data-new-youtube>
          Tentar outro link
        </button>
      </div>
    `;
    youtubeView.querySelector("[data-new-youtube]").addEventListener(
      "click",
      () => renderYoutubeForm(),
    );
    window.Iconify?.scan?.(youtubeView);
  }
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

