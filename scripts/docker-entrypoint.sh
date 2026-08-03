#!/bin/sh
set -eu
mkdir -p "${AUDIO_JOB_ROOT:-/data/jobs}" "${TORCH_HOME:-/model-cache/torch}" "${XDG_CACHE_HOME:-/model-cache}"
if [ -z "${MUSICAI_DATABASE_PATH:-}" ]; then
  echo "MUSICAI_DATABASE_PATH must be set" >&2
  exit 1
fi
mkdir -p "$(dirname "$MUSICAI_DATABASE_PATH")"
exec "$@"
