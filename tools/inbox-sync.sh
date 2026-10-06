#!/usr/bin/env bash
# [Local, launchd] UCI- und berlin.de-Seite vom Mac holen und auf den VPS legen.
# Warum vom Mac: beide Seiten antworten dem VPS (Rechenzentrums-IP) mit HTTP 403.
# Der Sync im Container nimmt Dateien aus /opt/kino/data/inbox (< 36 h alt) vor dem Live-Abruf.
# Jede Quelle für sich: holen, prüfen, atomar veröffentlichen (Upload als .tmp, dann mv). Eine kaputte
# Quelle blockiert die andere nicht. scp -p erhält die mtime = Capture-Zeit, die der Sync als Alter nutzt.
set -uo pipefail
# launchd hat nur einen Minimal-PATH: Homebrew/usr/local anhängen, vorhandenen PATH nicht ersetzen.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
UA='LiLief-Kino/1.0 (private use; tuncay)'
INBOX=/opt/kino/data/inbox
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
log() { echo "[$(date '+%F %T')] $*"; }

publish() { # name url marker
  local name=$1 url=$2 marker=$3
  curl -fsS --max-time 60 -A "$UA" -o "$TMP/$name" "$url" || { log "FEHLER: $name nicht geladen"; return 1; }
  # Plausibilitätscheck: lieber nichts hochladen als eine Fehlerseite.
  grep -q "$marker" "$TMP/$name" || { log "FEHLER: $name ohne '$marker'"; return 1; }
  scp -pq "$TMP/$name" "vps:$INBOX/.$name.tmp" && ssh vps mv "$INBOX/.$name.tmp" "$INBOX/$name" || { log "FEHLER: $name Upload"; return 1; }
  log "$name veröffentlicht"
}

ssh vps "mkdir -p $INBOX" || { log "FEHLER: VPS nicht erreichbar"; exit 1; }
failed=0 published=0
publish uci.html https://www.uci-kinowelt.de/kinoprogramm/berlin-mercedes-platz/82 'badge-performance' && published=1 || failed=1
publish berlinde-alhambra.html https://www.berlin.de/kino/_bin/kinodetail.php/34187/ 'Filme im Cineplex Alhambra' && published=1 || failed=1
# Sofort einlesen, sonst warten die Daten bis zum nächsten 12-h-Lauf. Läuft dort gerade ein Sync (Lease),
# überspringt dieser Lauf; die Dateien bleiben 36 h gültig.
if [ "$published" = 1 ]; then
  ssh vps 'docker compose -f /opt/kino/deploy/compose.yml exec -T kino-api node src/sync/run.js' || failed=1
fi
log "fertig"
exit "$failed"
