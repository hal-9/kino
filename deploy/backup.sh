#!/usr/bin/env bash
# [VPS] Nächtliches SQLite-Backup wie beim Workout-Stack (Crontab: 25 3 * * *).
# sqlite3 .backup ist WAL-sicher; 14 Tage aufbewahren.
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p /opt/kino/backups
sqlite3 /opt/kino/data/app.db ".backup /opt/kino/backups/app_$TS.db"
find /opt/kino/backups -name "app_*.db" -mtime +14 -delete
