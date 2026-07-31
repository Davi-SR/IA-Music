import { useEffect, useState, type ReactNode } from "react";
import logoUrl from "../../assets/Logo.png";
import { getCurrentUser, logoutUser } from "../api/auth";
import { useCustomCursor } from "../hooks/useCustomCursor";
import type { AuthUser } from "../types";
import { AuthGateProvider, type AuthState, useAuthGate } from "./AuthGate";
import { Icon } from "./Icon";

interface AppShellProps {
  activePage: "home" | "musics" | "auth";
  children: ReactNode;
}

export function AppShell({ activePage, children }: AppShellProps) {
  const cursor = useCustomCursor();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const isHome = activePage === "home";
  const isMusics = activePage === "musics";

  useEffect(() => {
    const controller = new AbortController();
    void getCurrentUser(controller.signal)
      .then(({ user: currentUser }) => {
        if (controller.signal.aborted) return;
        setUser(currentUser);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setUser(null);
        setAuthState("guest");
      });
    return () => controller.abort();
  }, []);

  const logout = async () => {
    try {
      await logoutUser();
    } finally {
      setUser(null);
      window.location.assign("auth.html");
    }
  };

  return (
    <AuthGateProvider authState={authState}>
      <>
      <a className="skip-link" href={isHome ? "#workspace" : isMusics ? "#library" : "#auth-title"}>
        Ir para o conteúdo principal
      </a>
      <div
        id="cursor"
        className={cursor.hovered ? "hovered" : ""}
        style={{ left: cursor.x, top: cursor.y }}
        aria-hidden="true"
      />
      <div className="noise-overlay" aria-hidden="true" />
      <div className="ambient-layer" aria-hidden="true">
        <span className="liquid-blob liquid-blob--blue" />
        <span className="liquid-blob liquid-blob--purple" />
        <span className="liquid-blob liquid-blob--cyan" />
        <div className="audio-grid" />
      </div>
      <header className="site-header">
        <nav
          className="nav-shell glass-panel glass-panel--static"
          aria-label="Principal"
        >
          <a
            className="brand cursor-hover"
            href={isHome ? "#top" : "index.html"}
            aria-label="MUSICAI, início"
          >
            <span className="brand__name">MUSICAI</span>
          </a>
          <div className="nav-links">
              <a
                className={`cursor-hover${isHome ? " active" : ""}`}
                href="index.html"
                aria-current={isHome ? "page" : undefined}
              >
                Home
              </a>
              <LibraryNavigationLink active={isMusics} />
          </div>
          <div className="nav-account">
            {user ? (
              <div className="account-group">
                <a
                  className="account-action cursor-hover"
                  href="auth.html?mode=account"
                  title={`Gerenciar conta ${user.email}`}
                >
                  <AccountAvatar user={user} />
                  <span>{user.name}</span>
                </a>
                <button
                  className="account-logout cursor-hover"
                  type="button"
                  onClick={() => void logout()}
                  aria-label="Sair da conta"
                >
                  <Icon name="log-out" />
                </button>
              </div>
            ) : (
              <a
                className="account-action account-action--login cursor-hover"
                href="auth.html"
              >
                <Icon name="log-in" />
                <span>Entrar</span>
              </a>
            )}
          </div>
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <div className="footer-inner">
          <a className="brand" href={isHome ? "#top" : "index.html"}>
            <span className="brand__name">MUSICAI</span>
          </a>
          <p>
            {isHome
              ? "Separação de áudio com clareza em cada etapa."
              : "Sua biblioteca, suas faixas, sua mixagem."}
          </p>
          <div className="footer-logo" aria-hidden="true">
            <img src={logoUrl} alt="" />
          </div>
        </div>
      </footer>
      </>
    </AuthGateProvider>
  );
}

function LibraryNavigationLink({ active }: { active: boolean }) {
  const { requestAccess } = useAuthGate();
  return (
    <a
      className={`cursor-hover${active ? " active" : ""}`}
      href="musics.html"
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (!requestAccess("library", "musics.html#library")) {
          event.preventDefault();
        }
      }}
    >
      Minhas Músicas
    </a>
  );
}

function AccountAvatar({ user }: { user: AuthUser }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [user.avatar_url]);

  return (
    <span className="account-avatar">
      {user.avatar_url && !imageFailed ? (
        <img
          src={user.avatar_url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <Icon name="user-round" />
      )}
    </span>
  );
}