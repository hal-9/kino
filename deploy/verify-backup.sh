#!/usr/bin/env bash
# [VPS] Backup prüfen: vorhanden, lesbar, integrity_check ok, keine FK-Verstöße, schema_migrations befüllt.
# Exit ≠ 0 und Meldung auf stderr bei jedem Problem (Cron-Log / Mail).
set -euo pipefail
F=${1:?Backup-Datei angeben}
fail() { echo "FEHLER: Backup $F: $*" >&2; exit 1; }
[ -s "$F" ] || fail "fehlt oder leer"
ic=$(sqlite3 -readonly "$F" "PRAGMA integrity_check;" 2>&1) || fail "nicht lesbar"
[ "$ic" = "ok" ] || fail "integrity_check meldet Fehler"
fk=$(sqlite3 -readonly "$F" "PRAGMA foreign_key_check;" 2>&1) || fail "foreign_key_check nicht ausführbar"
[ -z "$fk" ] || fail "foreign_key_check meldet Verstöße"
n=$(sqlite3 -readonly "$F" "SELECT COUNT(*) FROM schema_migrations;" 2>/dev/null) || fail "keine Tabelle schema_migrations"
[ "$n" -gt 0 ] || fail "schema_migrations leer"
echo "ok: $F ($n Migrationen)"
