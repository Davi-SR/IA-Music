"""SQLite authentication, secure sessions, password reset, and Google OAuth."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import smtplib
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from email.message import EmailMessage
from typing import Iterable
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

from backend.config import Settings


LOGGER = logging.getLogger(__name__)
SESSION_COOKIE = "musicai_session"
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


class AuthError(Exception):
    """Authentication error carrying a safe public message."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class AuthUser:
    id: str
    email: str
    name: str
    has_password: bool
    google_connected: bool
    avatar_url: str | None
    created_at: float


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=10, max_length=128)


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class ChangePasswordRequest(BaseModel):
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str | None = Field(default=None, max_length=128)


def _normalize_email(raw_email: str) -> str:
    email = raw_email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise AuthError(422, "INVALID_EMAIL", "Informe um e-mail válido.")
    return email


def _normalize_name(raw_name: str) -> str:
    name = " ".join(raw_name.strip().split())
    if len(name) < 2 or len(name) > 80:
        raise AuthError(422, "INVALID_NAME", "Informe um nome entre 2 e 80 caracteres.")
    return name


def _normalize_avatar_url(raw_url: str | None) -> str | None:
    """Accept only bounded HTTPS profile images returned by OAuth providers."""
    value = (raw_url or "").strip()
    if not value or len(value) > 2048:
        return None
    parsed = urlparse(value)
    return value if parsed.scheme == "https" and bool(parsed.netloc) else None

def _validate_password(password: str) -> None:
    if (
        len(password) < 10
        or not any(character.isalpha() for character in password)
        or not any(character.isdigit() for character in password)
    ):
        raise AuthError(
            422,
            "WEAK_PASSWORD",
            "Use pelo menos 10 caracteres, incluindo letras e números.",
        )


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    cost, block_size, parallelism = 2**14, 8, 1
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=cost, r=block_size, p=parallelism, dklen=32
    )
    return (
        f"scrypt${cost}${block_size}${parallelism}$"
        f"{salt.hex()}${digest.hex()}"
    )


def _verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, cost, block_size, parallelism, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt),
            n=int(cost),
            r=int(block_size),
            p=int(parallelism),
            dklen=32,
        )
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(digest.hex(), expected)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _safe_next_path(raw_path: str | None) -> str:
    path = (raw_path or "musics.html").strip()
    if (
        path.startswith(("http:", "https:", "//", "\\"))
        or "\r" in path
        or "\n" in path
        or not path.startswith(("index.html", "musics.html"))
    ):
        return "musics.html"
    return path[:500]


class AuthService:
    """Thread-safe repository using one short-lived SQLite connection per call."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        settings.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.settings.database_path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS app_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    name TEXT NOT NULL,
                    password_hash TEXT,
                    google_sub TEXT UNIQUE,
                    avatar_url TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL,
                    used_at REAL
                );
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state_hash TEXT PRIMARY KEY,
                    next_path TEXT NOT NULL,
                    expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_owners (
                    job_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS job_owners_user_idx ON job_owners(user_id);
                """
            )
            user_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(users)")
            }
            if "avatar_url" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT")

    @staticmethod
    def _user(row: sqlite3.Row) -> AuthUser:
        return AuthUser(
            id=row["id"],
            email=row["email"],
            name=row["name"],
            has_password=bool(row["password_hash"]),
            google_connected=bool(row["google_sub"]),
            avatar_url=str(row["avatar_url"]) if row["avatar_url"] else None,
            created_at=float(row["created_at"]),
        )

    def get_user(self, user_id: str) -> AuthUser:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if row is None:
            raise AuthError(401, "UNAUTHENTICATED", "Sua sessão não é mais válida.")
        return self._user(row)

    def register(self, name: str, email: str, password: str) -> tuple[AuthUser, bool]:
        name, email = _normalize_name(name), _normalize_email(email)
        _validate_password(password)
        now, user_id = time.time(), str(uuid.uuid4())
        try:
            with self._connect() as connection:
                first_user = connection.execute(
                    "SELECT COUNT(*) FROM users"
                ).fetchone()[0] == 0
                connection.execute(
                    """
                    INSERT INTO users
                        (id, email, name, password_hash, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, email, name, _hash_password(password), now, now),
                )
        except sqlite3.IntegrityError as exc:
            raise AuthError(
                409, "EMAIL_ALREADY_EXISTS", "Já existe uma conta com este e-mail."
            ) from exc
        return self.get_user(user_id), first_user

    def login(self, email: str, password: str) -> AuthUser:
        email = _normalize_email(email)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone()
        if row is None or not _verify_password(password, row["password_hash"]):
            raise AuthError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.")
        return self._user(row)

    def create_session(self, user_id: str) -> str:
        token, now = secrets.token_urlsafe(48), time.time()
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            connection.execute(
                """
                INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    _token_hash(token),
                    user_id,
                    now + self.settings.session_ttl_seconds,
                    now,
                ),
            )
        return token

    def authenticate(self, token: str | None) -> AuthUser | None:
        if not token:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.* FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                """,
                (_token_hash(token), time.time()),
            ).fetchone()
        return self._user(row) if row else None

    def revoke_session(self, token: str | None) -> None:
        if token:
            with self._connect() as connection:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),)
                )

    def create_password_reset(self, email: str) -> str | None:
        email = _normalize_email(email)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone()
            if row is None:
                return None
            token = secrets.token_urlsafe(48)
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE user_id = ?", (row["id"],)
            )
            connection.execute(
                """
                INSERT INTO password_reset_tokens
                    (token_hash, user_id, expires_at, used_at)
                VALUES (?, ?, ?, NULL)
                """,
                (
                    _token_hash(token),
                    row["id"],
                    time.time() + self.settings.password_reset_ttl_seconds,
                ),
            )
        return token

    def reset_password(self, token: str, password: str) -> None:
        _validate_password(password)
        now = time.time()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT user_id FROM password_reset_tokens
                WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
                """,
                (_token_hash(token), now),
            ).fetchone()
            if row is None:
                raise AuthError(
                    400,
                    "INVALID_RESET_TOKEN",
                    "Este link de redefinição é inválido ou expirou.",
                )
            connection.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (_hash_password(password), now, row["user_id"]),
            )
            connection.execute(
                "UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?",
                (now, _token_hash(token)),
            )
            connection.execute(
                "DELETE FROM sessions WHERE user_id = ?", (row["user_id"],)
            )

    def update_profile(self, user_id: str, name: str) -> AuthUser:
        with self._connect() as connection:
            connection.execute(
                "UPDATE users SET name = ?, updated_at = ? WHERE id = ?",
                (_normalize_name(name), time.time(), user_id),
            )
        return self.get_user(user_id)

    def change_password(
        self, user_id: str, current_password: str | None, new_password: str
    ) -> None:
        _validate_password(new_password)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT password_hash FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if row is None:
                raise AuthError(401, "UNAUTHENTICATED", "Sua sessão não é válida.")
            if row["password_hash"] and not _verify_password(
                current_password or "", row["password_hash"]
            ):
                raise AuthError(
                    400, "INVALID_CURRENT_PASSWORD", "A senha atual está incorreta."
                )
            connection.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (_hash_password(new_password), time.time(), user_id),
            )

    def delete_account(self, user: AuthUser, password: str | None) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT password_hash FROM users WHERE id = ?", (user.id,)
            ).fetchone()
            if row and row["password_hash"] and not _verify_password(
                password or "", row["password_hash"]
            ):
                raise AuthError(
                    400,
                    "INVALID_CURRENT_PASSWORD",
                    "Informe sua senha atual para excluir a conta.",
                )
            connection.execute("DELETE FROM users WHERE id = ?", (user.id,))

    def create_oauth_state(self, next_path: str | None) -> str:
        state, now = secrets.token_urlsafe(40), time.time()
        with self._connect() as connection:
            connection.execute("DELETE FROM oauth_states WHERE expires_at <= ?", (now,))
            connection.execute(
                "INSERT INTO oauth_states VALUES (?, ?, ?)",
                (_token_hash(state), _safe_next_path(next_path), now + 600),
            )
        return state

    def consume_oauth_state(self, state: str) -> str:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT next_path FROM oauth_states WHERE state_hash = ? AND expires_at > ?",
                (_token_hash(state), time.time()),
            ).fetchone()
            connection.execute(
                "DELETE FROM oauth_states WHERE state_hash = ?", (_token_hash(state),)
            )
        if row is None:
            raise AuthError(400, "INVALID_OAUTH_STATE", "A tentativa de login expirou.")
        return str(row["next_path"])

    def upsert_google_user(
        self, google_sub: str, email: str, name: str, avatar_url: str | None
    ) -> tuple[AuthUser, bool]:
        email = _normalize_email(email)
        name = _normalize_name(name or email.split("@")[0])
        avatar_url = _normalize_avatar_url(avatar_url)
        now = time.time()
        with self._connect() as connection:
            first_user = connection.execute(
                "SELECT COUNT(*) FROM users"
            ).fetchone()[0] == 0
            row = connection.execute(
                "SELECT * FROM users WHERE google_sub = ? OR email = ? COLLATE NOCASE",
                (google_sub, email),
            ).fetchone()
            if row is None:
                user_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO users
                        (id, email, name, google_sub, avatar_url, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, email, name, google_sub, avatar_url, now, now),
                )
            else:
                user_id = str(row["id"])
                if row["google_sub"] and row["google_sub"] != google_sub:
                    raise AuthError(
                        409,
                        "GOOGLE_ACCOUNT_CONFLICT",
                        "Este e-mail já está conectado a outra conta Google.",
                    )
                connection.execute(
                    """
                    UPDATE users
                    SET google_sub = ?, name = ?, avatar_url = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (google_sub, name, avatar_url, now, user_id),
                )
        return self.get_user(user_id), first_user

    def claim_job(self, job_id: str, user_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO job_owners VALUES (?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET user_id = excluded.user_id
                """,
                (job_id, user_id, time.time()),
            )

    def claim_unowned_jobs(self, job_ids: Iterable[str], user_id: str) -> None:
        """Assign legacy jobs only once for the lifetime of this database."""
        with self._connect() as connection:
            claimed = connection.execute(
                "SELECT 1 FROM app_meta WHERE key = 'legacy_jobs_claimed'"
            ).fetchone()
            if claimed:
                return
            connection.executemany(
                "INSERT OR IGNORE INTO job_owners VALUES (?, ?, ?)",
                [(job_id, user_id, time.time()) for job_id in job_ids],
            )
            connection.execute(
                "INSERT INTO app_meta (key, value) VALUES ('legacy_jobs_claimed', ?)",
                (user_id,),
            )


    def owns_job(self, job_id: str, user_id: str) -> bool:
        with self._connect() as connection:
            return connection.execute(
                "SELECT 1 FROM job_owners WHERE job_id = ? AND user_id = ?",
                (job_id, user_id),
            ).fetchone() is not None

    def owned_job_ids(self, user_id: str) -> set[str]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT job_id FROM job_owners WHERE user_id = ?", (user_id,)
            ).fetchall()
        return {str(row["job_id"]) for row in rows}


def require_user(request: Request) -> AuthUser:
    service: AuthService = request.app.state.auth_service
    user = service.authenticate(request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise AuthError(401, "UNAUTHENTICATED", "Entre na sua conta para continuar.")
    return user


def require_job_owner(request: Request, job_id: str) -> AuthUser:
    user = require_user(request)
    service: AuthService = request.app.state.auth_service
    if not service.owns_job(job_id, user.id):
        raise AuthError(404, "JOB_NOT_FOUND", "Música não encontrada.")
    return user


def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def _send_reset_email(settings: Settings, recipient: str, reset_url: str) -> None:
    if not settings.smtp_host or not settings.smtp_sender:
        LOGGER.warning("Password reset requested but SMTP is not configured.")
        return
    message = EmailMessage()
    message["Subject"] = "Redefina sua senha do MUSICAI"
    message["From"] = settings.smtp_sender
    message["To"] = recipient
    message.set_content(
        "Recebemos uma solicitação para redefinir sua senha.\n\n"
        f"Acesse: {reset_url}\n\n"
        "Se você não solicitou isso, ignore esta mensagem."
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)


def _send_reset_email_safe(settings: Settings, recipient: str, reset_url: str) -> None:
    try:
        _send_reset_email(settings, recipient, reset_url)
    except (OSError, smtplib.SMTPException):
        LOGGER.exception("Could not send password reset e-mail")


def install_auth_routes(
    app: FastAPI,
    settings: Settings,
    service: AuthService,
    legacy_job_ids: Iterable[str],
) -> None:
    """Register authentication endpoints before the static catch-all route."""
    app.state.auth_service = service

    @app.exception_handler(AuthError)
    async def auth_error_handler(_: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    def session_response(
        user: AuthUser, status_code: int = 200
    ) -> JSONResponse:
        response = JSONResponse({"user": asdict(user)}, status_code=status_code)
        _set_cookie(response, service.create_session(user.id), settings)
        return response

    @app.post("/api/auth/register", status_code=201)
    async def register(payload: RegisterRequest) -> JSONResponse:
        user, first = service.register(payload.name, payload.email, payload.password)
        if first:
            service.claim_unowned_jobs(legacy_job_ids, user.id)
        return session_response(user, status_code=201)

    @app.post("/api/auth/login")
    async def login(payload: LoginRequest) -> JSONResponse:
        return session_response(service.login(payload.email, payload.password))

    @app.post("/api/auth/logout", status_code=204)
    async def logout(request: Request) -> Response:
        service.revoke_session(request.cookies.get(SESSION_COOKIE))
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @app.get("/api/auth/me")
    async def me(request: Request) -> dict[str, object]:
        return {"user": asdict(require_user(request))}

    @app.patch("/api/auth/me")
    async def update_me(
        payload: UpdateProfileRequest, request: Request
    ) -> dict[str, object]:
        return {"user": asdict(service.update_profile(require_user(request).id, payload.name))}

    @app.put("/api/auth/password", status_code=204)
    async def change_password(
        payload: ChangePasswordRequest, request: Request
    ) -> Response:
        service.change_password(
            require_user(request).id,
            payload.current_password,
            payload.new_password,
        )
        return Response(status_code=204)

    @app.delete("/api/auth/me", status_code=204)
    async def delete_me(
        payload: DeleteAccountRequest, request: Request
    ) -> Response:
        service.delete_account(require_user(request), payload.password)
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @app.post("/api/auth/forgot-password", status_code=202)
    async def forgot(
        payload: ForgotPasswordRequest, background_tasks: BackgroundTasks
    ) -> dict[str, str]:
        token = service.create_password_reset(payload.email)
        if token:
            url = (
                f"{settings.public_base_url.rstrip('/')}/auth.html"
                f"?mode=reset&token={token}"
            )
            background_tasks.add_task(
                _send_reset_email_safe,
                settings,
                _normalize_email(payload.email),
                url,
            )
        return {
            "message": (
                "Se o e-mail estiver cadastrado, enviaremos as instruções "
                "para redefinir a senha."
            )
        }

    @app.post("/api/auth/reset-password", status_code=204)
    async def reset(payload: ResetPasswordRequest) -> Response:
        service.reset_password(payload.token, payload.password)
        return Response(status_code=204)

    @app.get("/api/auth/google/start")
    async def google_start(
        request: Request, next: str | None = None
    ) -> RedirectResponse:
        if not settings.google_client_id or not settings.google_client_secret:
            raise AuthError(
                503,
                "GOOGLE_AUTH_NOT_CONFIGURED",
                "O login com Google ainda não foi configurado.",
            )
        state = service.create_oauth_state(next)
        redirect_uri = settings.google_redirect_uri or str(
            request.url_for("google_callback")
        )
        query = urlencode(
            {
                "client_id": settings.google_client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "prompt": "select_account",
            }
        )
        return RedirectResponse(f"{GOOGLE_AUTHORIZE_URL}?{query}", status_code=302)

    @app.get("/api/auth/google/callback", name="google_callback")
    async def google_callback(
        request: Request, state: str, code: str
    ) -> RedirectResponse:
        next_path = service.consume_oauth_state(state)
        redirect_uri = settings.google_redirect_uri or str(
            request.url_for("google_callback")
        )
        async with httpx.AsyncClient(timeout=20) as client:
            token_response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                },
            )
            if not token_response.is_success:
                raise AuthError(
                    400, "GOOGLE_AUTH_FAILED", "Não foi possível concluir o login Google."
                )
            user_response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={
                    "Authorization": (
                        f"Bearer {token_response.json().get('access_token', '')}"
                    )
                },
            )
        profile = user_response.json() if user_response.is_success else {}
        if not profile.get("email_verified"):
            raise AuthError(
                400,
                "GOOGLE_AUTH_FAILED",
                "Não foi possível validar seu e-mail Google.",
            )
        user, first = service.upsert_google_user(
            str(profile["sub"]),
            str(profile["email"]),
            str(profile.get("name") or ""),
            str(profile.get("picture") or "") or None,
        )
        if first:
            service.claim_unowned_jobs(legacy_job_ids, user.id)
        response = RedirectResponse(f"/{_safe_next_path(next_path)}", status_code=303)
        _set_cookie(response, service.create_session(user.id), settings)
        return response
