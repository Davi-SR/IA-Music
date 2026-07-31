# Autenticação e bibliotecas privadas

O MUSICAI usa SQLite em `data/musicai.db`. O banco guarda usuários, hashes
`scrypt`, sessões, tokens de redefinição, estados OAuth e o vínculo entre cada
job e seu proprietário. Arquivos de áudio continuam em `data/jobs`.

Na primeira conta criada, os jobs antigos ainda sem proprietário são migrados
para essa conta. Essa migração acontece uma única vez por banco.

## Desenvolvimento local

O backend carrega automaticamente o arquivo `.env` da raiz do projeto. Copie `.env.example` para `.env`, preencha os valores e reinicie o FastAPI. Variáveis já definidas no PowerShell têm precedência sobre o arquivo:

```powershell
$env:MUSICAI_PUBLIC_BASE_URL="http://127.0.0.1:8000"
$env:MUSICAI_SECURE_COOKIES="false"
uv run uvicorn main:app --host 127.0.0.1 --port 8000
```

Em outro terminal:

```powershell
cd frontend
npm run dev
```

## Google OAuth

No Google Cloud Console, configure a tela de consentimento, adicione seu Gmail em **Usuários de teste** enquanto o aplicativo estiver em modo de teste e crie um cliente OAuth 2.0 do tipo “Aplicativo da Web”. Cadastre exatamente esta URI de redirecionamento autorizada:

```text
http://127.0.0.1:8000/api/auth/google/callback
```

Depois configure:

```powershell
$env:GOOGLE_CLIENT_ID="seu-client-id"
$env:GOOGLE_CLIENT_SECRET="seu-client-secret"
$env:GOOGLE_REDIRECT_URI="http://127.0.0.1:8000/api/auth/google/callback"
```

Os mesmos valores podem ser colocados diretamente no `.env`, sem `$env:` e sem necessidade de exportá-los no terminal. O `GOOGLE_CLIENT_ID` costuma terminar em `.apps.googleusercontent.com`. Reinicie o backend após qualquer alteração.

Em produção, troque a URI pelo domínio HTTPS público e use:

```powershell
$env:MUSICAI_PUBLIC_BASE_URL="https://musicai.seudominio.com"
$env:MUSICAI_SECURE_COOKIES="true"
```

## Recuperação de senha por e-mail

Exemplo com Gmail e senha de aplicativo:

```powershell
$env:MUSICAI_SMTP_HOST="smtp.gmail.com"
$env:MUSICAI_SMTP_PORT="587"
$env:MUSICAI_SMTP_STARTTLS="true"
$env:MUSICAI_SMTP_USERNAME="conta@gmail.com"
$env:MUSICAI_SMTP_PASSWORD="senha-de-aplicativo"
$env:MUSICAI_SMTP_SENDER="conta@gmail.com"
```

Sem SMTP, o endpoint continua respondendo de forma neutra, mas nenhum e-mail é
enviado. Isso evita revelar se uma conta existe.

## Contrato principal

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET/PATCH/DELETE /api/auth/me`
- `PUT /api/auth/password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`

O cookie `musicai_session` é `HttpOnly`, `SameSite=Lax` e deve usar `Secure`
em produção.
