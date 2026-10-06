#!/usr/bin/env bash
# [Local, launchd] UCI- und berlin.de-Seite vom Mac holen und auf den VPS legen.
# Warum vom Mac: beide Seiten antworten dem VPS (Rechenzentrums-IP) mit HTTP 403.
# Der Sync im Container nimmt Dateien aus /opt/kino/data/inbox (< 36 h alt) vor dem Live-Abruf.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
UA='LiLief-Kino/1.0 (private use; tuncay)'
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
log() { echo "[$(date '+%F %T')] $*"; }

curl -fsS --max-time 60 -A "$UA" -o "$TMP/uci.html" https://www.uci-kinowelt.de/kinoprogramm/berlin-mercedes-platz/82
curl -fsS --max-time 60 -A "$UA" -o "$TMP/berlinde-alhambra.html" https://www.berlin.de/kino/_bin/kinodetail.php/34187/
# Plausibilitätscheck: lieber nichts hochladen als eine Fehlerseite.
grep -q 'badge-performance' "$TMP/uci.html" || { log "FEHLER: UCI-Seite ohne Vorstellungen"; exit 1; }
grep -q 'Filme im Cineplex Alhambra' "$TMP/berlinde-alhambra.html" || { log "FEHLER: berlin.de-Seite ohne Alhambra-Block"; exit 1; }

ssh vps 'mkdir -p /opt/kino/data/inbox'
scp -q "$TMP/uci.html" "$TMP/berlinde-alhambra.html" vps:/opt/kino/data/inbox/
# Sofort einlesen, sonst warten die Daten bis zum nächsten 12-h-Lauf.
ssh vps 'docker compose -f /opt/kino/deploy/compose.yml exec -T kino-api node src/sync/run.js'
log "fertig"
