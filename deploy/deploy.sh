#!/usr/bin/env bash
# [VPS] Läuft in /opt/kino. Baut das Frontend im Node-Container, tauscht den
# Inhalt von deploy/frontend-dist (Bind-Mount in Caddy: nie das Verzeichnis
# löschen, sonst zeigt Caddy auf einen verwaisten Inode) und startet die API neu.
set -euo pipefail

cd "$(dirname "$0")/.."

git pull

docker run --rm -v "$(pwd):/app" -w /app node:22 sh -c "npm ci && npm run build -w frontend"

mkdir -p deploy/frontend-dist /opt/kino/data
find deploy/frontend-dist -mindepth 1 -delete
cp -r frontend/dist/. deploy/frontend-dist/

cd deploy
docker compose up -d --build kino-api
