#!/usr/bin/env bash
# [VPS] SQLite-Backup (Crontab: 25 3 * * *; deploy.sh ruft es vor jedem Release mit Label "pre-<sha>" auf).
# sqlite3 .backup ist WAL-sicher, danach verify-backup.sh (Exit ≠ 0 bei Fehler); 14 Tage aufbewahren.
set -euo pipefail
ROOT="${KINO_ROOT:-/opt/kino}"
DB="${KINO_DB:-$ROOT/data/app.db}"
DIR="${BACKUP_DIR:-$ROOT/backups}"
LABEL=${1:-}
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p "$DIR"
[ -f "$DB" ] || { echo "FEHLER: Keine Datenbank unter $DB" >&2; exit 1; }
OUT="$DIR/app_${TS}${LABEL:+_$LABEL}.db"
sqlite3 "$DB" ".backup '$OUT'"
# Eigenständige Datei ohne WAL/-shm (lässt sich read-only prüfen und als eine Datei kopieren).
sqlite3 "$OUT" "PRAGMA journal_mode=DELETE;" >/dev/null
"$(dirname "$0")/verify-backup.sh" "$OUT" >&2
find "$DIR" -name "app_*.db" -mtime +14 -delete
echo "$OUT"
