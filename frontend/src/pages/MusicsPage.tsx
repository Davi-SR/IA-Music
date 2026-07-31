import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getLibrary } from "../api/client";
import { AppShell } from "../components/AppShell";
import { useAuthGate } from "../components/AuthGate";
import { Icon } from "../components/Icon";
import { LibraryView } from "../features/library/LibraryView";
import { Mixer } from "../features/library/Mixer";
import type { LibraryItem } from "../types";

type LoadState = "loading" | "ready" | "error" | "locked";

export function MusicsPage() {
  return (
    <AppShell activePage="musics">
      <MusicsContent />
    </AppShell>
  );
}

function MusicsContent() {
  const { authState, requestAccess } = useAuthGate();
  const [route, setRoute] = useState(() => window.location.hash || "#library");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!window.location.hash.startsWith("#library")) {
      history.replaceState(null, "", "#library");
      setRoute("#library");
    }
    const onHash = () => setRoute(decodeURIComponent(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (authState === "loading") return;
    if (authState === "guest") {
      setLoadState("locked");
      requestAccess("library", `musics.html${window.location.hash || "#library"}`);
      return;
    }
    const controller = new AbortController();
    setLoadState("loading");
    void getLibrary(controller.signal)
      .then((payload) => {
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setError("");
        setLoadState("ready");
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        if (loadError instanceof ApiError && loadError.status === 401) {
          setLoadState("locked");
          requestAccess("library", `musics.html${window.location.hash || "#library"}`);
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar sua biblioteca.",
        );
        setLoadState("error");
      });
    return () => controller.abort();
  }, [authState, requestAccess, revision]);

  const mixerId = useMemo(
    () => route.match(/^#library\/([0-9a-f-]{36})$/i)?.[1] ?? null,
    [route],
  );
  const mixerItem = mixerId
    ? items.find((item) => item.job_id === mixerId) ?? null
    : null;
  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  return (
    <main id="top">
        <section className="library-section" id="library">
          {loadState === "loading" && <Loading message={mixerId ? "Preparando o mixer…" : "Carregando suas músicas…"} />}
          {loadState === "locked" && (
            <LockedLibrary onLogin={() =>
              requestAccess("library", `musics.html${window.location.hash || "#library"}`)
            } />
          )}
          {loadState === "error" && <LibraryError message={error} showBack={Boolean(mixerId)} />}
          {loadState === "ready" && mixerId && !mixerItem && (
            <LibraryError message="Essa música não foi encontrada na biblioteca." showBack />
          )}
          {loadState === "ready" && mixerItem && <Mixer item={mixerItem} />}
          {loadState === "ready" && !mixerId && (
            <LibraryView items={items} onRefresh={refresh} />
          )}
        </section>
    </main>
  );
}

function LockedLibrary({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="library-shell glass-panel glass-panel--static">
      <div className="library-locked">
        <div className="library-locked__content">
          <span className="library-locked__icon"><Icon name="lock-keyhole" /></span>
          <p className="micro-label">Biblioteca particular</p>
          <h2>Suas músicas ficam protegidas aqui</h2>
          <p>Entre para abrir seus projetos, ouvir as faixas e continuar suas mixagens.</p>
          <button className="button button--primary cursor-hover" type="button" onClick={onLogin}>
            <Icon name="log-in" /> Entrar para acessar
          </button>
        </div>
      </div>
    </div>
  );
}
function Loading({ message }: { message: string }) {
  return (
    <div className="library-shell glass-panel glass-panel--static">
      <div className="library-loading">
        <div className="library-loading__content">
          <span className="youtube-job__spinner" aria-hidden="true" />
          <p>{message}</p>
        </div>
      </div>
    </div>
  );
}

function LibraryError({
  message,
  showBack = false,
}: {
  message: string;
  showBack?: boolean;
}) {
  return (
    <div className="library-shell glass-panel glass-panel--static">
      <div className="library-error">
        <div className="library-empty__content">
          <span className="library-empty__icon"><Icon name="circle-alert" /></span>
          <h2>Não foi possível abrir essa área</h2>
          <p>{message}</p>
          <a
            className="button button--primary"
            style={{ marginTop: 24 }}
            href={showBack ? "#library" : "index.html#workspace"}
          >
            {showBack ? "Voltar à biblioteca" : "Voltar ao início"}
          </a>
        </div>
      </div>
    </div>
  );
}
