import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icon";

export type AuthState = "loading" | "authenticated" | "guest";
export type AuthIntent = "upload" | "youtube" | "library";

interface GateRequest {
  intent: AuthIntent;
  next: string;
}

interface AuthGateValue {
  authState: AuthState;
  requestAccess: (intent: AuthIntent, next?: string) => boolean;
}

const AuthGateContext = createContext<AuthGateValue | null>(null);

const copy: Record<AuthIntent, { eyebrow: string; title: string; body: string }> = {
  upload: {
    eyebrow: "Seu estúdio particular",
    title: "Entre antes de enviar seu áudio",
    body: "Assim, cada processamento fica protegido e salvo somente na sua biblioteca.",
  },
  youtube: {
    eyebrow: "Do link para sua biblioteca",
    title: "Entre para processar este vídeo",
    body: "Sua sessão mantém o processamento seguro e permite acompanhar o resultado de qualquer tela.",
  },
  library: {
    eyebrow: "Sua música · seu espaço",
    title: "Esta biblioteca é particular",
    body: "Entre para ouvir, mixar e baixar apenas as faixas vinculadas à sua conta.",
  },
};

export function AuthGateProvider({
  authState,
  children,
}: {
  authState: AuthState;
  children: ReactNode;
}) {
  const [request, setRequest] = useState<GateRequest | null>(null);
  const closeGate = useCallback(() => setRequest(null), []);

  useEffect(() => {
    if (authState === "authenticated") setRequest(null);
  }, [authState]);

  const requestAccess = useCallback(
    (intent: AuthIntent, next = "index.html#workspace") => {
      if (authState === "authenticated") return true;
      setRequest({ intent, next });
      return false;
    },
    [authState],
  );

  const value = useMemo(
    () => ({ authState, requestAccess }),
    [authState, requestAccess],
  );

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      {request && (
        <AuthGateDialog
          authState={authState}
          request={request}
          onClose={closeGate}
        />
      )}
    </AuthGateContext.Provider>
  );
}

export function useAuthGate(): AuthGateValue {
  const context = useContext(AuthGateContext);
  if (!context) {
    throw new Error("useAuthGate must be used inside AuthGateProvider.");
  }
  return context;
}

function AuthGateDialog({
  authState,
  request,
  onClose,
}: {
  authState: AuthState;
  request: GateRequest;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const loginLink = useRef<HTMLAnchorElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const content = copy[request.intent];
  const next = encodeURIComponent(request.next);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => loginLink.current?.focus(), 80);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = originalOverflow;
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const keepFocusInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const elements = dialog.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!elements?.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="auth-gate-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="auth-gate glass-panel glass-panel--static"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-gate-title"
        aria-describedby="auth-gate-copy"
        onKeyDown={keepFocusInside}
      >
        <span className="auth-gate__orb auth-gate__orb--one" aria-hidden="true" />
        <span className="auth-gate__orb auth-gate__orb--two" aria-hidden="true" />
        <button
          className="auth-gate__close cursor-hover"
          type="button"
          aria-label="Fechar aviso de autenticação"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
        <div className="auth-gate__visual" aria-hidden="true">
          <span className="auth-gate__ring" />
          <span className="auth-gate__icon"><Icon name="lock-keyhole" /></span>
          <span className="auth-gate__spark auth-gate__spark--one" />
          <span className="auth-gate__spark auth-gate__spark--two" />
        </div>
        <div className="auth-gate__copy">
          <p className="micro-label"><Icon name="sparkles" /> {content.eyebrow}</p>
          <h2 id="auth-gate-title">{content.title}</h2>
          <p id="auth-gate-copy">{content.body}</p>
          {authState === "loading" && (
            <p className="auth-gate__checking" role="status">
              <Icon name="loader-circle" /> Verificando sua sessão…
            </p>
          )}
        </div>
        <div className="auth-gate__actions">
          <button
            className="button button--secondary cursor-hover"
            type="button"
            onClick={onClose}
          >
            Agora não
          </button>
          <a
            ref={loginLink}
            className="button button--primary cursor-hover"
            href={`auth.html?next=${next}`}
          >
            <Icon name="log-in" /> Entrar
          </a>
        </div>
        <p className="auth-gate__register">
          Primeira vez por aqui? <a href={`auth.html?mode=register&next=${next}`}>Criar conta</a>
        </p>
      </div>
    </div>
  );
}
