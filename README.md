# MUSICAI

Aplicação FastAPI para separar uma música em seis stems com o modelo
`htdemucs_6s`: voz, bateria, baixo, guitarra, piano e outros. A origem pode ser
um arquivo MP3/WAV ou a URL de um vídeo do YouTube.

O frontend usa React, TypeScript e Vite, com duas páginas: Home e Minhas
Músicas/mixer. O FastAPI continua servindo o build e todos os contratos da API.

## Pré-requisitos

- Python 3.10 ou superior
- Node.js 20 ou superior
- FFmpeg e FFprobe disponíveis no `PATH`
- `uv`

No Windows:

```powershell
winget install "FFmpeg (Essentials Build)"
```

Reabra o terminal/IDE após a instalação e confirme com `ffmpeg -version`.

## Instalação e execução

Backend:

```powershell
uv sync
uv run python main.py
```

Frontend, somente quando o código React for alterado:

```powershell
cd frontend
npm install
npm run build
cd ..
```

Abra `http://127.0.0.1:8000`. A própria API serve o build em
`Front/glass-effect2`. A documentação OpenAPI fica em
`http://127.0.0.1:8000/docs`.

Durante o desenvolvimento do frontend:

```powershell
cd frontend
npm run dev
```

O Vite encaminha `/api` para `http://127.0.0.1:8000`.

## API

Crie um job enviando exatamente uma origem:

```text
POST /api/jobs
multipart: file=<MP3 ou WAV>
```

ou:

```text
POST /api/jobs
multipart: youtube_url=https://www.youtube.com/watch?v=...
```

Depois consulte, reproduza e baixe:

```text
GET /api/jobs/{job_id}
GET /api/jobs/{job_id}/download
GET /api/library
GET /api/jobs/{job_id}/stems/{stem}
GET /api/jobs/{job_id}/stems/{stem}/download
GET /api/health
```

Os jobs ficam em `data/jobs/{job_id}`. O backend baixa URLs com `yt-dlp`,
converte com FFmpeg, executa o Demucs fora do processo HTTP e compacta os seis
WAVs em um ZIP. Por padrão há um worker, adequado para evitar disputa excessiva
de CPU e memória em uma estação local.

## Configuração

Variáveis opcionais:

- `AUDIO_JOB_ROOT`: diretório persistente dos jobs;
- `AUDIO_MAX_UPLOAD_BYTES`: limite de upload (padrão 500 MB);
- `AUDIO_MAX_CONCURRENT_JOBS`: workers Demucs (padrão 1);
- `AUDIO_PROCESS_TIMEOUT_SECONDS`: timeout do subprocesso (padrão 7200);
- `AUDIO_DEMUCS_EXECUTABLE`: comando/caminho do Demucs;
- `AUDIO_CORS_ORIGINS`: origens separadas por vírgula, se front e API forem
  publicados em hosts diferentes.

## Testes

Backend:

```powershell
uv run pytest
```

Frontend:

```powershell
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:visual
```

Os testes do backend usam um gerenciador de jobs falso; não baixam vídeos e não
executam FFmpeg ou Demucs. O relatório da migração React e a comparação visual
estão em `frontend/MIGRATION.md`.


## Autenticação e bibliotecas privadas

Consulte `AUTHENTICATION.md` e `.env.example` para configurar SQLite, login Google, cookies e recuperação de senha por SMTP.
