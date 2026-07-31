# MUSICAI — build do front-end

Este diretório é a saída de produção servida pelo FastAPI. O código-fonte fica
em `frontend/` e usa React, TypeScript e Vite.

Na raiz do projeto, execute:

```powershell
cd frontend
npm install
npm run build
cd ..
uv run python main.py
```

Abra `http://127.0.0.1:8000/`. A Home está em `index.html` e a biblioteca/mixer
em `musics.html`. O build preserva `design-system.html` e os assets de fonte e
ícones existentes.

O frontend usa os contratos do FastAPI sem adaptação:

```text
POST /api/jobs
GET  /api/jobs/{job_id}
GET  /api/jobs/{job_id}/download
GET  /api/library
GET  /api/jobs/{job_id}/stems/{stem}
GET  /api/jobs/{job_id}/stems/{stem}/download
```

O POST multipart recebe exatamente um dos campos:

- `file`: MP3 ou WAV de até 500 MB;
- `youtube_url`: URL de um vídeo do YouTube.
