#!/usr/bin/env bash
# [VPS] SQLite-Backup (Crontab: 25 3 * * *; deploy.sh ruft es vor jedem Release mit Label "pre-<sha>" auf).
# sqlite3 .backup ist WAL-sicher; 14 Tage aufbewahren.
set -euo pipefail
ROOT="${KINO_ROOT:-/opt/kino}"
DB="${KINO_DB:-$ROOT/data/app.db}"
DIR="${BACKUP_DIR:-$ROOT/backups}"
LABEL=${1:-}
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p "$DIR"
[ -f "$DB" ] || { echo "Keine Datenbank unter $DB - nichts zu sichern" >&2; exit 0; }
OUT="$DIR/app_${TS}${LABEL:+_$LABEL}.db"
sqlite3 "$DB" ".backup '$OUT'"
find "$DIR" -name "app_*.db" -mtime +14 -delete
echo "$OUT"
