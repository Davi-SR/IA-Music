# MUSICAI

Aplicação FastAPI para separar uma música em seis stems com o modelo
`htdemucs_6s`: voz, bateria, baixo, guitarra, piano e outros. A origem pode ser
um arquivo MP3/WAV ou a URL de um vídeo do YouTube.

## Pré-requisitos

- Python 3.10
- FFmpeg e FFprobe disponíveis no `PATH`
- `uv`

No Windows:

```powershell
winget install "FFmpeg (Essentials Build)"
```

Reabra o terminal/IDE após a instalação e confirme com `ffmpeg -version`.

## Instalação e execução

```powershell
uv sync
uv run python main.py
```

Abra `http://127.0.0.1:8000`. A própria API serve o front-end. A documentação
OpenAPI fica em `http://127.0.0.1:8000/docs`.

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

Depois consulte e baixe:

```text
GET /api/jobs/{job_id}
GET /api/jobs/{job_id}/download
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

```powershell
uv run pytest
```

Os testes usam um gerenciador de jobs falso; não baixam vídeos e não executam
FFmpeg ou Demucs.
