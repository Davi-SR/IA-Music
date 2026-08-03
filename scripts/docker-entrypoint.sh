#!/bin/sh
set -eu
mkdir -p "${AUDIO_JOB_ROOT:-/data/jobs}" "${TORCH_HOME:-/model-cache/torch}" "${XDG_CACHE_HOME:-/model-cache}"

if [ -n "${MUSICAI_YOUTUBE_COOKIES_B64:-}" ]; then
  youtube_cookie_file="${AUDIO_YOUTUBE_COOKIE_FILE:-/data/youtube-cookies.txt}"
  printf '%s' "$MUSICAI_YOUTUBE_COOKIES_B64" | base64 -d > "$youtube_cookie_file"
  chmod 600 "$youtube_cookie_file"
  export AUDIO_YOUTUBE_COOKIE_FILE="$youtube_cookie_file"
  echo "YouTube cookie file configured at $youtube_cookie_file ($(wc -c < "$youtube_cookie_file") bytes)"
elif [ -n "${MUSICAI_YOUTUBE_COOKIES:-}" ]; then
  youtube_cookie_file="${AUDIO_YOUTUBE_COOKIE_FILE:-/data/youtube-cookies.txt}"
  printf '%b' "$MUSICAI_YOUTUBE_COOKIES" > "$youtube_cookie_file"
  chmod 600 "$youtube_cookie_file"
  export AUDIO_YOUTUBE_COOKIE_FILE="$youtube_cookie_file"
  echo "YouTube cookie file configured at $youtube_cookie_file ($(wc -c < "$youtube_cookie_file") bytes)"
fi

if command -v deno >/dev/null 2>&1; then
  deno --version | head -n 1
else
  echo "Deno runtime was not found on PATH" >&2
fi
if [ -z "${MUSICAI_DATABASE_PATH:-}" ]; then
  echo "MUSICAI_DATABASE_PATH must be set" >&2
  exit 1
fi
mkdir -p "$(dirname "$MUSICAI_DATABASE_PATH")"
exec "$@"
