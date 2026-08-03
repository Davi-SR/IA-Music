#!/bin/sh
set -eu
source=${1:-}
db_path=${MUSICAI_DATABASE_PATH:-/data/musicai.db}
[ -n "$source" ] && [ -f "$source" ] || { echo "Usage: restore-sqlite.sh /path/to/backup.db" >&2; exit 2; }
sqlite3 "$source" 'PRAGMA integrity_check;' | grep -qx 'ok' || { echo "Backup is corrupt" >&2; exit 1; }
mkdir -p "$(dirname "$db_path")"
sqlite3 "$source" ".backup '$db_path'"
echo "Database restored to: $db_path"
