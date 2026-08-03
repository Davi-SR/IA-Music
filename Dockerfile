FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    AUDIO_JOB_ROOT=/data/jobs \
    MUSICAI_DATABASE_PATH=/data/musicai.db \
    AUDIO_FRONTEND_DIR=/app/empty-frontend \
    TORCH_HOME=/model-cache/torch \
    XDG_CACHE_HOME=/model-cache

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg sqlite3 libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip install --no-cache-dir "tensorflow==2.11.1"

RUN ffmpeg -version >/dev/null 2>&1 && ffprobe -version >/dev/null 2>&1 && demucs --help >/dev/null 2>&1

COPY backend ./backend
COPY main.py audio_preprocessing.py audio_to_midi.py pipeline.py ./
COPY scripts ./scripts

RUN mkdir -p /app/empty-frontend /data/jobs /model-cache \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin musicai \
    && chmod +x /app/scripts/*.sh \
    && chown -R musicai:musicai /app /data /model-cache

USER musicai
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl --fail --silent http://127.0.0.1:8000/api/health || exit 1
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
