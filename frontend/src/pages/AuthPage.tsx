import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  changePassword,
  deleteAccount,
  getCurrentUser,
  googleLoginUrl,
  loginUser,
  logoutUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  updateProfile,
} from "../api/auth";
import { ApiError } from "../api/client";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";
import type { AuthUser } from "../types";

type AuthMode = "login" | "register" | "forgot" | "reset" | "account";

function initialMode(): AuthMode {
  const value = new URLSearchParams(window.location.search).get("mode");
  return ["register", "forgot", "reset", "account"].includes(value ?? "")
    ? (value as AuthMode)
    : "login";
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "Não foi possível concluir a solicitação.";
}

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedNext = query.get("next") ?? "";
  const nextPath = requestedNext.startsWith("index.html")
    || requestedNext.startsWith("musics.html")
    ? requestedNext
    : "musics.html";
  const resetToken = query.get("token") ?? "";

  useEffect(() => {
    if (mode !== "account") return;
    const controller = new AbortController();
    void getCurrentUser(controller.signal)
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => {
        window.location.replace(
          `auth.html?next=${encodeURIComponent("auth.html?mode=account")}`,
        );
      });
    return () => controller.abort();
  }, [mode]);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        await loginUser(
          String(form.get("email") ?? ""),
          String(form.get("password") ?? ""),
        );
        window.location.assign(nextPath);
        return;
      }
      if (mode === "register") {
        const password = String(form.get("password") ?? "");
        if (password !== String(form.get("confirm_password") ?? "")) {
          throw new Error("As senhas não coincidem.");
        }
        await registerUser(
          String(form.get("name") ?? ""),
          String(form.get("email") ?? ""),
          password,
        );
        window.location.assign(nextPath);
        return;
      }
      if (mode === "forgot") {
        const response = await requestPasswordReset(
          String(form.get("email") ?? ""),
        );
        setMessage(response.message);
        return;
      }
      if (!resetToken) {
        throw new Error("O link de redefinição está incompleto.");
      }
      const password = String(form.get("password") ?? "");
      if (password !== String(form.get("confirm_password") ?? "")) {
        throw new Error("As senhas não coincidem.");
      }
      await resetPassword(resetToken, password);
      setMessage("Senha redefinida. Agora você já pode entrar.");
      setMode("login");
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "account") {
    return (
      <AppShell activePage="auth">
        <main className="auth-main" id="main-content">
          <AccountPanel
            user={user}
            onUserChange={setUser}
            onError={setError}
            onMessage={setMessage}
            error={error}
            message={message}
          />
        </main>
      </AppShell>
    );
  }

  const copy = {
    login: ["Bem-vindo de volta", "Entre para acessar sua biblioteca particular."],
    register: ["Crie seu espaço", "Suas músicas e faixas ficam vinculadas à sua conta."],
    forgot: ["Recupere sua conta", "Enviaremos um link seguro para redefinir sua senha."],
    reset: ["Escolha uma nova senha", "O link só pode ser usado uma vez."],
  }[mode];

  return (
    <AppShell activePage="auth">
      <main className="auth-main" id="main-content">
        <section className="auth-layout">
          <div className="auth-intro">
            <p className="micro-label">Sua música · sua biblioteca</p>
            <h1>Cada camada.<span>Só para você.</span></h1>
            <p>
              Entre para processar músicas, abrir o mixer e encontrar todos os
              seus projetos em qualquer sessão.
            </p>
          </div>
          <article className="auth-card glass-panel glass-panel--static">
            <header>
              <span className="auth-card__icon"><Icon name="user-round" /></span>
              <h2>{copy[0]}</h2>
              <p>{copy[1]}</p>
            </header>

            {(mode === "login" || mode === "register") && (
              <>
                <a
                  className="google-button cursor-hover"
                  href={googleLoginUrl(nextPath)}
                >
                  <span aria-hidden="true">G</span>
                  Continuar com Google
                </a>
                <div className="auth-divider"><span>ou use seu e-mail</span></div>
              </>
            )}

            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              {mode === "register" && (
                <label>
                  <span>Nome</span>
                  <input name="name" autoComplete="name" required minLength={2} />
                </label>
              )}
              {mode !== "reset" && (
                <label>
                  <span>E-mail</span>
                  <input name="email" type="email" autoComplete="email" required />
                </label>
              )}
              {(mode === "login" || mode === "register" || mode === "reset") && (
                <label>
                  <span>{mode === "reset" ? "Nova senha" : "Senha"}</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={mode === "login" ? 1 : 10}
                  />
                  {mode !== "login" && (
                    <small>Mínimo de 10 caracteres, com letras e números.</small>
                  )}
                </label>
              )}
              {(mode === "register" || mode === "reset") && (
                <label>
                  <span>Confirmar senha</span>
                  <input name="confirm_password" type="password" autoComplete="new-password" required minLength={10} />
                </label>
              )}
              {error && <div className="auth-message auth-message--error">{error}</div>}
              {message && <div className="auth-message auth-message--success">{message}</div>}
              <button className="button button--primary button--full" disabled={busy}>
                {busy ? "Aguarde…" : {
                  login: "Entrar",
                  register: "Criar conta",
                  forgot: "Enviar instruções",
                  reset: "Redefinir senha",
                }[mode]}
              </button>
            </form>

            <footer className="auth-card__footer">
              {mode === "login" && (
                <>
                  <button type="button" onClick={() => changeMode("forgot")}>Esqueci minha senha</button>
                  <p>Ainda não tem conta? <button type="button" onClick={() => changeMode("register")}>Cadastre-se</button></p>
                </>
              )}
              {mode === "register" && (
                <p>Já tem uma conta? <button type="button" onClick={() => changeMode("login")}>Entrar</button></p>
              )}
              {(mode === "forgot" || mode === "reset") && (
                <button type="button" onClick={() => changeMode("login")}>← Voltar ao login</button>
              )}
            </footer>
          </article>
        </section>
      </main>
    </AppShell>
  );
}

function AccountPanel({
  user,
  onUserChange,
  onError,
  onMessage,
  error,
  message,
}: {
  user: AuthUser | null;
  onUserChange: (user: AuthUser) => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  error: string;
  message: string;
}) {
  const run = async (operation: () => Promise<void>, success: string) => {
    onError("");
    onMessage("");
    try {
      await operation();
      onMessage(success);
    } catch (operationError) {
      onError(errorMessage(operationError));
    }
  };

  if (!user) {
    return <div className="auth-account-loading">Carregando sua conta…</div>;
  }

  return (
    <section className="account-layout">
      <header className="account-heading">
        <p className="micro-label">Conta MUSICAI</p>
        <h1>Olá, {user.name.split(" ")[0]}.</h1>
        <p>Gerencie seus dados, sua senha e o acesso à biblioteca.</p>
      </header>
      {error && <div className="auth-message auth-message--error">{error}</div>}
      {message && <div className="auth-message auth-message--success">{message}</div>}
      <div className="account-grid">
        <form
          className="auth-card account-card glass-panel glass-panel--static auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("name") ?? "");
            void run(async () => {
              const response = await updateProfile(name);
              onUserChange(response.user);
            }, "Perfil atualizado.");
          }}
        >
          <h2>Perfil</h2>
          <label><span>Nome</span><input name="name" defaultValue={user.name} required /></label>
          <label><span>E-mail</span><input value={user.email} disabled /></label>
          <button className="button button--primary">Salvar perfil</button>
        </form>

        <form
          className="auth-card account-card glass-panel glass-panel--static auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run(
              () => changePassword(
                String(data.get("current_password") ?? ""),
                String(data.get("new_password") ?? ""),
              ),
              "Senha atualizada. Use a nova senha no próximo login.",
            );
          }}
        >
          <h2>Senha</h2>
          {user.has_password && (
            <label><span>Senha atual</span><input name="current_password" type="password" required /></label>
          )}
          <label><span>Nova senha</span><input name="new_password" type="password" minLength={10} required /></label>
          <button className="button button--secondary">Atualizar senha</button>
        </form>

        <form
          className="auth-card account-card account-card--danger glass-panel glass-panel--static auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!window.confirm("Excluir sua conta? Essa ação não pode ser desfeita.")) return;
            const password = String(new FormData(event.currentTarget).get("password") ?? "");
            void run(async () => {
              await deleteAccount(password);
              await logoutUser().catch(() => undefined);
              window.location.assign("auth.html");
            }, "");
          }}
        >
          <h2>Excluir conta</h2>
          <p>Remove seu usuário e desvincula sua biblioteca.</p>
          {user.has_password && (
            <label><span>Confirme sua senha</span><input name="password" type="password" required /></label>
          )}
          <button className="button button--danger">Excluir minha conta</button>
        </form>
      </div>
    </section>
  );
}
