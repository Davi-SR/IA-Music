#!/bin/sh
set -eu
curl --fail --silent --show-error "${HEALTHCHECK_URL:-http://127.0.0.1:8000/api/health}" >/dev/null
