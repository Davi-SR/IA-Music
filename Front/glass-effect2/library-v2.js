const CONFIG = window.__AUDIO_SEPARATOR_CONFIG__;
const main = document.querySelector("main");
const navLinks = document.querySelector(".nav-links");

const TRACK_UI = Object.freeze({
  vocals: { name: "Voz", subtitle: "Vocals", icon: "mic-2" },
  drums: { name: "Bateria", subtitle: "Drums", icon: "drum" },
  bass: { name: "Baixo", subtitle: "Bass", icon: "music-2" },
  guitar: { name: "Guitarra", subtitle: "Guitar", icon: "guitar" },
  piano: { name: "Piano", subtitle: "Piano", icon: "piano" },
  other: { name: "Outros", subtitle: "Other", icon: "sparkles" },
});

let librarySection = null;
let currentMixer = null;
let libraryItems = [];
let originalSections = [];

if (CONFIG && main && navLinks) {
  installLibrary();
}

function installLibrary() {
  originalSections = Array.from(main.children);
  librarySection = document.createElement("section");
  librarySection.className = "library-section";
  librarySection.id = "library";
  librarySection.hidden = true;
  main.append(librarySection);

  const libraryLink = document.createElement("a");
  libraryLink.className = "cursor-hover library-nav-link";
  libraryLink.href = "#library";
  libraryLink.innerHTML = `
    <span class="iconify" data-icon="lucide:library"></span>
    Minhas músicas
  `;
  navLinks.prepend(libraryLink);

  window.addEventListener("hashchange", routeLibrary);
  document.addEventListener("click", handleLibraryClick);
  observeCompletedJobs();
  routeLibrary();
  window.Iconify?.scan?.(libraryLink);
}

async function routeLibrary() {
  const hash = decodeURIComponent(window.location.hash);
  if (!hash.startsWith("#library")) {
    closeLibrary();
    return;
  }

  showLibrary();
  const match = hash.match(/^#library\/([0-9a-f-]{36})$/i);
  if (match) {
    await openMixer(match[1]);
  } else {
    await renderLibrary();
  }
}

function showLibrary() {
  for (const section of originalSections) section.hidden = true;
  librarySection.hidden = false;
  document.body.classList.add("is-library-open");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeLibrary() {
  currentMixer?.destroy();
  currentMixer = null;
  for (const section of originalSections) section.hidden = false;
  if (librarySection) librarySection.hidden = true;
  document.body.classList.remove("is-library-open");
}

async function renderLibrary() {
  currentMixer?.destroy();
  currentMixer = null;
  librarySection.innerHTML = renderLoading();
  try {
    const response = await fetch(apiUrl(CONFIG.endpoints.library), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload?.error?.message || "Não foi possível carregar sua biblioteca.",
      );
    }
    libraryItems = Array.isArray(payload.items) ? payload.items : [];
    librarySection.innerHTML = renderLibraryContent(libraryItems);
    window.Iconify?.scan?.(librarySection);
  } catch (error) {
    librarySection.innerHTML = renderLibraryError(error.message);
    window.Iconify?.scan?.(librarySection);
  }
}

function renderLibraryContent(items) {
  const content = items.length
    ? `<div class="library-grid">${items.map(renderMusicCard).join("")}</div>`
    : `
      <div class="library-empty">
        <div class="library-empty__content">
          <span class="library-empty__icon">
            <span class="iconify" data-icon="lucide:audio-lines"></span>
          </span>
          <h2>Sua biblioteca está esperando a primeira música</h2>
          <p>Quando uma separação terminar, ela aparecerá aqui com todas as faixas prontas para ouvir.</p>
          <a class="button button--primary" href="#workspace" style="margin-top: 24px">
            Separar uma música
          </a>
        </div>
      </div>
    `;
  return `
    <div class="library-shell glass-panel glass-panel--static">
      <header class="library-header">
        <div>
          <p class="micro-label">Seu espaço musical</p>
          <h1>Minhas músicas</h1>
          <p>Ouça, misture e baixe as faixas que você já separou.</p>
        </div>
        <div class="library-actions">
          <button class="button button--secondary" type="button" data-library-refresh>
            <span class="iconify" data-icon="lucide:refresh-cw"></span>
            Atualizar
          </button>
          <a class="button button--primary" href="#workspace">
            <span class="iconify" data-icon="lucide:plus"></span>
            Nova música
          </a>
        </div>
      </header>
      ${content}
    </div>
  `;
}

function renderMusicCard(item) {
  const date = item.completed_at
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(item.completed_at * 1000))
    : "Processada recentemente";
  return `
    <article class="music-card">
      <div class="music-card__top">
        <span class="music-card__art">
          <span class="iconify" data-icon="lucide:audio-waveform"></span>
        </span>
        <div class="music-card__copy">
          <h2 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h2>
          <p>${item.source_type === "youtube" ? "YouTube" : "Upload"} · ${escapeHtml(date)}</p>
        </div>
      </div>
      <div class="music-card__stems">
        ${item.stems
          .map((stem) => `<span class="stem-chip">${escapeHtml(stem.name)}</span>`)
          .join("")}
      </div>
      <div class="music-card__actions">
        <a class="button button--primary" href="#library/${encodeURIComponent(item.job_id)}">
          <span class="iconify" data-icon="lucide:sliders-horizontal"></span>
          Abrir mixer
        </a>
        <a class="button button--secondary" href="${escapeHtml(apiUrl(item.download_url))}">
          <span class="iconify" data-icon="lucide:download"></span>
          ZIP
        </a>
      </div>
    </article>
  `;
}

async function openMixer(jobId) {
  currentMixer?.destroy();
  currentMixer = null;
  librarySection.innerHTML = renderLoading("Preparando o mixer…");
  try {
    if (!libraryItems.length) {
      const response = await fetch(apiUrl(CONFIG.endpoints.library), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Não foi possível abrir a biblioteca.");
      const payload = await response.json();
      libraryItems = Array.isArray(payload.items) ? payload.items : [];
    }
    const item = libraryItems.find((candidate) => candidate.job_id === jobId);
    if (!item) throw new Error("Essa música não foi encontrada na biblioteca.");

    librarySection.innerHTML = renderMixer(item);
    currentMixer = new StemMixer(item, librarySection);
    await currentMixer.initialize();
    window.Iconify?.scan?.(librarySection);
  } catch (error) {
    librarySection.innerHTML = renderLibraryError(error.message, true);
    window.Iconify?.scan?.(librarySection);
  }
}

class StemMixer {
  constructor(item, root) {
    this.item = item;
    this.root = root;
    this.tracks = [];
    this.duration = 0;
    this.playing = false;
    this.masterVolume = 1;
    this.rafId = null;
    this.lastSyncAt = 0;
    this.destroyed = false;
  }

  async initialize() {
    this.tracks = this.item.stems.map((stem) => {
      const audio = new Audio(apiUrl(stem.stream_url));
      audio.preload = "metadata";
      return {
        stem,
        audio,
        volume: 0.85,
        muted: false,
        solo: false,
      };
    });

    this.bindControls();
    this.duration = Number(this.item.duration_seconds) || 0;
    const metadataChecks = this.tracks.map((track) =>
      waitForMetadata(track.audio)
        .then((duration) => {
          if (!this.duration && Number.isFinite(duration)) {
            this.activateTransport(duration);
            this.setStatus("Tudo pronto. Dê play e monte sua própria mixagem.");
            this.applyVolumes();
          }
          return duration;
        })
        .catch(() => null),
    );

    if (this.duration) {
      this.activateTransport(this.duration);
      this.setStatus("Tudo pronto. Dê play e monte sua própria mixagem.");
      this.applyVolumes();
      void Promise.allSettled(metadataChecks);
      return;
    }

    await Promise.race([
      Promise.allSettled(metadataChecks),
      new Promise((resolve) => window.setTimeout(resolve, 3000)),
    ]);
    if (!this.duration && !this.destroyed) {
      this.setStatus(
        "As faixas continuam carregando. O player será liberado automaticamente.",
      );
    }
  }

  activateTransport(duration) {
    this.duration = Math.max(this.duration, duration);
    this.root.querySelector("[data-mixer-seek]").max = String(this.duration);
    this.root.querySelector("[data-time-total]").textContent =
      formatTime(this.duration);
    this.root.querySelector("[data-mixer-play]").disabled = false;
  }

  bindControls() {
    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("input", this.handleInput);
  }

  handleClick = (event) => {
    const playButton = event.target.closest("[data-mixer-play]");
    if (playButton) {
      this.playing ? this.pause() : this.play();
      return;
    }

    const muteButton = event.target.closest("[data-track-mute]");
    if (muteButton) {
      const track = this.findTrack(muteButton.dataset.trackMute);
      if (track) {
        track.muted = !track.muted;
        muteButton.classList.toggle("is-active", track.muted);
        muteButton.setAttribute("aria-pressed", String(track.muted));
        this.applyVolumes();
        this.renderTrackState(track);
      }
      return;
    }

    const soloButton = event.target.closest("[data-track-solo]");
    if (soloButton) {
      const track = this.findTrack(soloButton.dataset.trackSolo);
      if (track) {
        track.solo = !track.solo;
        soloButton.classList.toggle("is-active", track.solo);
        soloButton.setAttribute("aria-pressed", String(track.solo));
        this.applyVolumes();
        this.renderAllTrackStates();
      }
    }
  };

  handleInput = (event) => {
    if (event.target.matches("[data-track-volume]")) {
      const track = this.findTrack(event.target.dataset.trackVolume);
      if (!track) return;
      track.volume = Number(event.target.value) / 100;
      event.target
        .closest(".track-volume")
        .querySelector("output").textContent = `${event.target.value}%`;
      this.applyVolumes();
      return;
    }

    if (event.target.matches("[data-master-volume]")) {
      this.masterVolume = Number(event.target.value) / 100;
      this.applyVolumes();
      return;
    }

    if (event.target.matches("[data-mixer-seek]")) {
      this.seek(Number(event.target.value));
    }
  };

  async play() {
    if (!this.tracks.length || !this.duration) return;
    const position = this.currentTime() >= this.duration - 0.1
      ? 0
      : this.currentTime();
    for (const track of this.tracks) track.audio.currentTime = position;
    const results = await Promise.allSettled(
      this.tracks.map((track) => track.audio.play()),
    );
    if (results.every((result) => result.status === "rejected")) {
      this.setStatus("O navegador bloqueou a reprodução. Tente clicar em play novamente.");
      return;
    }
    this.playing = true;
    this.updatePlayButton();
    this.setStatus("Reproduzindo sua mixagem em tempo real.");
    this.tick();
  }

  pause() {
    for (const track of this.tracks) track.audio.pause();
    this.playing = false;
    window.cancelAnimationFrame(this.rafId);
    this.updatePlayButton();
    this.setStatus("Reprodução pausada.");
  }

  seek(position) {
    const safePosition = Math.max(0, Math.min(this.duration, position || 0));
    for (const track of this.tracks) {
      if (Number.isFinite(track.audio.duration)) {
        track.audio.currentTime = Math.min(safePosition, track.audio.duration);
      }
    }
    this.renderTime(safePosition);
  }

  tick = (timestamp = 0) => {
    if (!this.playing || this.destroyed) return;
    const current = this.currentTime();
    this.renderTime(current);

    if (timestamp - this.lastSyncAt > 1000) {
      this.correctDrift(current);
      this.lastSyncAt = timestamp;
    }
    if (current >= this.duration - 0.05) {
      this.pause();
      this.seek(0);
      this.setStatus("Fim da música.");
      return;
    }
    this.rafId = window.requestAnimationFrame(this.tick);
  };

  correctDrift(referenceTime) {
    for (const track of this.tracks.slice(1)) {
      if (
        Number.isFinite(track.audio.currentTime) &&
        Math.abs(track.audio.currentTime - referenceTime) > 0.09
      ) {
        track.audio.currentTime = referenceTime;
      }
    }
  }

  currentTime() {
    return this.tracks[0]?.audio.currentTime || 0;
  }

  applyVolumes() {
    const hasSolo = this.tracks.some((track) => track.solo);
    for (const track of this.tracks) {
      const audible = !track.muted && (!hasSolo || track.solo);
      track.audio.volume = audible
        ? Math.max(0, Math.min(1, track.volume * this.masterVolume))
        : 0;
    }
  }

  renderTime(position) {
    const seek = this.root.querySelector("[data-mixer-seek]");
    if (seek && !seek.matches(":active")) seek.value = String(position);
    this.root.querySelector("[data-time-current]").textContent =
      formatTime(position);
  }

  updatePlayButton() {
    const button = this.root.querySelector("[data-mixer-play]");
    button.innerHTML = this.playing
      ? '<span class="iconify" data-icon="lucide:pause"></span>'
      : '<span class="iconify" data-icon="lucide:play"></span>';
    button.setAttribute(
      "aria-label",
      this.playing ? "Pausar" : "Reproduzir",
    );
    window.Iconify?.scan?.(button);
  }

  renderTrackState(track) {
    const row = this.root.querySelector(
      `[data-track-row="${CSS.escape(track.stem.id)}"]`,
    );
    if (!row) return;
    const hasSolo = this.tracks.some((candidate) => candidate.solo);
    row.classList.toggle(
      "is-muted",
      track.muted || (hasSolo && !track.solo),
    );
    row.classList.toggle("is-solo", track.solo);
  }

  renderAllTrackStates() {
    for (const track of this.tracks) this.renderTrackState(track);
  }

  findTrack(id) {
    return this.tracks.find((track) => track.stem.id === id);
  }

  setStatus(message) {
    const status = this.root.querySelector("[data-mixer-status]");
    if (status) status.innerHTML = `
      <span class="iconify" data-icon="lucide:info"></span>
      ${escapeHtml(message)}
    `;
    window.Iconify?.scan?.(status);
  }

  destroy() {
    this.destroyed = true;
    this.playing = false;
    window.cancelAnimationFrame(this.rafId);
    for (const track of this.tracks) {
      track.audio.pause();
      track.audio.removeAttribute("src");
      track.audio.load();
    }
    this.root?.removeEventListener("click", this.handleClick);
    this.root?.removeEventListener("input", this.handleInput);
  }
}

function renderMixer(item) {
  return `
    <div class="library-shell glass-panel glass-panel--static">
      <header class="mixer-header">
        <div>
          <a href="#library" class="micro-label">
            ← Voltar para minhas músicas
          </a>
          <h1>${escapeHtml(item.title)}</h1>
          <p>Controle cada instrumento e crie a mixagem que você quer ouvir.</p>
        </div>
        <div class="library-actions">
          <a class="button button--secondary" href="${escapeHtml(apiUrl(item.download_url))}">
            <span class="iconify" data-icon="lucide:archive"></span>
            Baixar tudo
          </a>
        </div>
      </header>
      <div class="mixer-layout">
        <div class="mixer-console">
          <div class="mixer-transport">
            <button class="transport-play" type="button" data-mixer-play
              aria-label="Carregando faixas" disabled>
              <span class="iconify" data-icon="lucide:loader-circle"></span>
            </button>
            <div class="transport-timeline">
              <input class="range-control" type="range" data-mixer-seek
                min="0" max="0" step="0.05" value="0"
                aria-label="Posição da música" />
              <div class="transport-time">
                <span data-time-current>0:00</span>
                <span data-time-total>--:--</span>
              </div>
            </div>
            <label class="master-volume">
              <span class="iconify" data-icon="lucide:volume-2"></span>
              <input class="range-control" type="range" data-master-volume
                min="0" max="100" value="100" aria-label="Volume geral" />
            </label>
          </div>
          <div class="track-list">
            ${item.stems.map(renderMixerTrack).join("")}
          </div>
        </div>
        <aside class="mixer-now-playing">
          <div class="now-playing-art">
            <span class="iconify" data-icon="lucide:audio-waveform"></span>
          </div>
          <div>
            <p class="micro-label">Agora no mixer</p>
            <h2>${escapeHtml(item.title)}</h2>
            <p>${item.source_type === "youtube" ? "Importado do YouTube" : "Arquivo enviado"} · seis camadas sincronizadas</p>
            <div class="now-playing-stats">
              <div class="now-playing-stat">
                <small>Faixas</small>
                <strong>${item.stems.length}</strong>
              </div>
              <div class="now-playing-stat">
                <small>Qualidade</small>
                <strong>WAV</strong>
              </div>
            </div>
          </div>
          <div class="mixer-status" data-mixer-status>
            <span class="iconify" data-icon="lucide:loader-circle"></span>
            Carregando as faixas do mixer…
          </div>
        </aside>
      </div>
    </div>
  `;
}

function renderMixerTrack(stem) {
  const ui = TRACK_UI[stem.id] || {
    name: stem.name,
    subtitle: stem.id,
    icon: "music",
  };
  return `
    <div class="mixer-track" data-track-row="${escapeHtml(stem.id)}">
      <div class="track-identity">
        <span class="track-icon">
          <span class="iconify" data-icon="lucide:${ui.icon}"></span>
        </span>
        <div>
          <strong>${escapeHtml(ui.name)}</strong>
          <small>${escapeHtml(ui.subtitle)}</small>
        </div>
      </div>
      <div class="track-toggles">
        <button class="track-toggle" type="button"
          data-track-mute="${escapeHtml(stem.id)}"
          aria-label="Silenciar ${escapeHtml(ui.name)}" aria-pressed="false">M</button>
        <button class="track-toggle" type="button"
          data-track-solo="${escapeHtml(stem.id)}"
          aria-label="Ouvir apenas ${escapeHtml(ui.name)}" aria-pressed="false">S</button>
      </div>
      <label class="track-volume">
        <span class="sr-only">Volume de ${escapeHtml(ui.name)}</span>
        <input class="range-control" type="range"
          data-track-volume="${escapeHtml(stem.id)}"
          min="0" max="100" value="85" />
        <output>85%</output>
      </label>
      <a class="track-download" href="${escapeHtml(apiUrl(stem.download_url))}"
        aria-label="Baixar ${escapeHtml(ui.name)} separadamente">
        <span class="iconify" data-icon="lucide:download"></span>
      </a>
    </div>
  `;
}

function handleLibraryClick(event) {
  if (event.target.closest("[data-library-refresh]")) {
    renderLibrary();
  }
}

function observeCompletedJobs() {
  const decorate = () => {
    for (const link of document.querySelectorAll(
      '.youtube-job a[href*="/api/jobs/"][href$="/download"]',
    )) {
      const match = link.getAttribute("href")?.match(
        /\/api\/jobs\/([0-9a-f-]{36})\/download/i,
      );
      if (!match || link.parentElement.querySelector("[data-open-mixer]")) continue;
      const mixerLink = document.createElement("a");
      mixerLink.className = "button button--secondary";
      mixerLink.dataset.openMixer = "";
      mixerLink.href = `#library/${match[1]}`;
      mixerLink.innerHTML = `
        <span class="iconify" data-icon="lucide:sliders-horizontal"></span>
        Abrir no mixer
      `;
      link.after(mixerLink);
      window.Iconify?.scan?.(mixerLink);
    }
  };
  const observer = new MutationObserver(decorate);
  observer.observe(document.body, { childList: true, subtree: true });
  decorate();
}

function waitForMetadata(audio) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", checkDuration);
      audio.removeEventListener("durationchange", checkDuration);
      audio.removeEventListener("canplay", checkDuration);
      callback(value);
    };
    const checkDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        finish(resolve, audio.duration);
      }
    };
    const timeout = window.setTimeout(
      () => finish(reject, new Error("Tempo excedido ao carregar uma faixa.")),
      120000,
    );
    audio.addEventListener("loadedmetadata", checkDuration);
    audio.addEventListener("durationchange", checkDuration);
    audio.addEventListener("canplay", checkDuration);
    audio.addEventListener(
      "error",
      () => finish(reject, new Error("Falha ao carregar uma faixa.")),
      { once: true },
    );
    checkDuration();
    if (!settled) audio.load();
  });
}

function renderLoading(message = "Carregando suas músicas…") {
  return `
    <div class="library-shell glass-panel glass-panel--static">
      <div class="library-loading">
        <div class="library-loading__content">
          <span class="youtube-job__spinner" aria-hidden="true"></span>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    </div>
  `;
}

function renderLibraryError(message, showBack = false) {
  return `
    <div class="library-shell glass-panel glass-panel--static">
      <div class="library-error">
        <div class="library-empty__content">
          <span class="library-empty__icon">
            <span class="iconify" data-icon="lucide:circle-alert"></span>
          </span>
          <h2>Não foi possível abrir essa área</h2>
          <p>${escapeHtml(message)}</p>
          <a class="button button--primary" style="margin-top: 24px"
            href="${showBack ? "#library" : "#workspace"}">
            ${showBack ? "Voltar à biblioteca" : "Voltar ao início"}
          </a>
        </div>
      </div>
    </div>
  `;
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(CONFIG.apiBaseUrl || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

