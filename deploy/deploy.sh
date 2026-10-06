#!/usr/bin/env bash
# [VPS] Release bauen und prüfen, Backup, API umschalten, Readiness prüfen, dann erst Frontend veröffentlichen.
# Schlägt Build/Prüfung fehl, bleibt alles Live unverändert. Schlägt Readiness fehl, Rollback auf das vorige Release.
# Nur mit Freigabe des Owners auf dem VPS ausführen. Nicht lokal gegen den VPS laufen lassen.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
cd "$ROOT"

git pull --ff-only
SHA=$(git rev-parse --short HEAD)
PREV=$(cat "$REL/current" 2>/dev/null || true)
mkdir -p "$REL" "$ROOT/data"

# 1. Bauen in ein neues Release-Verzeichnis (Live-Frontend unberührt).
docker run --rm -v "$ROOT:/app" -w /app node:22 sh -c "npm ci && npm run build -w frontend" || die "Frontend-Build fehlgeschlagen, nichts geändert"
rm -rf "$REL/$SHA.tmp"
mkdir -p "$REL/$SHA.tmp"
cp -R frontend/dist/. "$REL/$SHA.tmp/"
check_release "$REL/$SHA.tmp"
ls backend/migrations > "$REL/$SHA.tmp/.migrations"
rm -rf "$REL/$SHA"
mv "$REL/$SHA.tmp" "$REL/$SHA"
KINO_API_TAG=$SHA compose build kino-api || die "API-Build fehlgeschlagen, nichts geändert"

# 2. Backup vor möglichen Migrationen (laufen beim API-Start).
"$HERE/backup.sh" "pre-$SHA"

# 3. API umschalten und prüfen.
KINO_API_TAG=$SHA compose up -d kino-api
if ! health_check; then
  echo "Readiness fehlgeschlagen für $SHA" >&2
  if [ -n "$PREV" ] && [ "$PREV" != "$SHA" ]; then "$HERE/rollback.sh" "$PREV" || echo "Rollback auf $PREV fehlgeschlagen - manuell eingreifen" >&2; fi
  exit 1
fi

# 4. Frontend veröffentlichen, Zustand merken, alte Releases/Assets begrenzt aufräumen.
publish_frontend "$REL/$SHA"
set_current "$SHA"
find "$DIST/assets" -type f -mtime +14 -delete 2>/dev/null || true
ls -1dt "$REL"/*/ 2>/dev/null | tail -n +6 | while read -r d; do rm -rf "$d"; done
echo "Release $SHA aktiv (vorher: ${PREV:-keins})"
