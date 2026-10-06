#!/usr/bin/env bash
# [VPS] Code-Rollback auf ein früheres Release: ./rollback.sh <sha>. Stellt KEINE Datenbank wieder her
# (das verlöre neuere Schreibvorgänge) und bricht ab, wenn das Schema nicht rückwärtskompatibel ist.
# Nur mit Freigabe des Owners ausführen.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"

TARGET=${1:?Release-SHA angeben}
[ -f "$REL/$TARGET/.migrations" ] || die "Release $TARGET nicht vorhanden"
schema_compatible "$REL/$TARGET/.migrations" || die "Schema nicht kompatibel mit $TARGET - kein Rollback. Siehe docs/DEPLOY.md (Rollback)."
check_release "$REL/$TARGET"

KINO_API_TAG=$TARGET compose up -d kino-api
health_check || die "Release $TARGET wird nicht bereit"
publish_frontend "$REL/$TARGET"
set_current "$TARGET"
echo "Rollback auf $TARGET aktiv"
