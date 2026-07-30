/**
 * Shared runtime configuration and page-specific asset loading.
 */
window.__AUDIO_SEPARATOR_CONFIG__ = Object.freeze({
  apiBaseUrl: "",
  maxFileSizeBytes: 500 * 1024 * 1024,
  uploadTimeoutMs: 10 * 60 * 1000,
  requestTimeoutMs: 15 * 1000,
  initialPollDelayMs: 2500,
  maxPollDelayMs: 30000,
  uploadFieldName: "file",
  youtubeUrlFieldName: "youtube_url",
  endpoints: Object.freeze({
    createJob: "/api/jobs",
    getJob: (jobId) => `/api/jobs/${encodeURIComponent(jobId)}`,
    downloadJob: (jobId) =>
      `/api/jobs/${encodeURIComponent(jobId)}/download`,
    library: "/api/library",
  }),
});

const isMusicsPage = /(?:^|\/)musics\.html$/i.test(
  window.location.pathname,
);

document.documentElement.classList.add(
  isMusicsPage ? "musics-booting" : "home-booting",
);

loadStylesheet("navigation.css?v=3");
if (isMusicsPage) {
  loadStylesheet("youtube.css?v=5");
  loadStylesheet("library.css?v=3");
  preloadModule("library-v3.js?v=5");
  preloadModule("cursor.js?v=2");
} else {
  loadStylesheet("youtube.css?v=5");
  loadStylesheet("youtube-progress.css?v=5");
  preloadModule("app.js");
  preloadModule("youtube-v2.js?v=5");
  preloadModule("completion-link.js?v=2");
}

window.addEventListener(
  "DOMContentLoaded",
  () => {
    renderPrimaryNavigation(isMusicsPage ? "musics" : "home");

    if (isMusicsPage) {
      if (!window.location.hash.startsWith("#library")) {
        history.replaceState(null, "", "#library");
      }
      loadModule("cursor.js?v=2");
      loadModule("library-v3.js?v=5", () => {
        renderPrimaryNavigation("musics");
        markPageReady("musics");
      });
      document.addEventListener("click", (event) => {
        if (event.target.closest('a[href="#workspace"]')) {
          event.preventDefault();
          window.location.href = "index.html#workspace";
        }
      });
      return;
    }

    loadModule("youtube-v2.js?v=5", () => markPageReady("home"));
    loadModule("completion-link.js?v=2");
  },
  { once: true },
);

window.setTimeout(
  () => markPageReady(isMusicsPage ? "musics" : "home"),
  5000,
);

function loadStylesheet(href) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  document.head.append(stylesheet);
}

function preloadModule(href) {
  const preload = document.createElement("link");
  preload.rel = "modulepreload";
  preload.href = href;
  document.head.append(preload);
}

function loadModule(src, onLoad = null) {
  const module = document.createElement("script");
  module.type = "module";
  module.src = src;
  if (onLoad) module.addEventListener("load", onLoad, { once: true });
  module.addEventListener(
    "error",
    () => markPageReady(isMusicsPage ? "musics" : "home"),
    { once: true },
  );
  document.body.append(module);
}

function markPageReady(page) {
  document.documentElement.classList.remove(`${page}-booting`);
  document.documentElement.classList.add(`${page}-ready`);
}

function renderPrimaryNavigation(activePage) {
  const navigation = document.querySelector(".nav-links");
  if (!navigation) return;
  navigation.innerHTML = `
    <a class="cursor-hover${activePage === "home" ? " active" : ""}"
      href="index.html"${activePage === "home" ? ' aria-current="page"' : ""}>
      Home
    </a>
    <a class="cursor-hover${activePage === "musics" ? " active" : ""}"
      href="musics.html"${activePage === "musics" ? ' aria-current="page"' : ""}>
      Minhas Músicas
    </a>
  `;
}

