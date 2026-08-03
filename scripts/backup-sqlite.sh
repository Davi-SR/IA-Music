#!/bin/sh
set -eu
db_path=${MUSICAI_DATABASE_PATH:-/data/musicai.db}
backup_dir=${BACKUP_DIR:-/data/backups}
mkdir -p "$backup_dir"
[ -f "$db_path" ] || { echo "SQLite database not found: $db_path" >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$backup_dir/musicai-$stamp.db"
sqlite3 "$db_path" ".backup '$destination'"
[ -s "$destination" ] || { echo "Backup was not created" >&2; exit 1; }
sqlite3 "$destination" 'PRAGMA integrity_check;' | grep -qx 'ok' || { echo "Backup integrity check failed" >&2; exit 1; }
echo "Backup created: $destination"
