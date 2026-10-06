# [VPS] Gemeinsame Funktionen für deploy.sh und rollback.sh (wird nur gesourct).
# KINO_ROOT (Standard /opt/kino) ist Checkout + Zustand; Tests setzen ihn auf ein Temp-Verzeichnis.
ROOT="${KINO_ROOT:-/opt/kino}"
DIST="$ROOT/deploy/frontend-dist"   # Bind-Mount in Caddy (/srv/kino): Verzeichnis nie löschen oder ersetzen
REL="$ROOT/deploy/releases"         # je Release: Frontend-Build + .migrations (Liste der enthaltenen Migrationen)
DB="${KINO_DB:-$ROOT/data/app.db}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
HEALTH_SLEEP="${HEALTH_SLEEP:-2}"

die() { echo "FEHLER: $*" >&2; exit 1; }

compose() { (cd "$ROOT/deploy" && docker compose "$@"); }

# Release prüfen, bevor irgendetwas Live angefasst wird: index.html + alle referenzierten /assets/ vorhanden.
check_release() {
  local dir=$1 ref
  [ -s "$dir/index.html" ] || die "Release $dir: index.html fehlt"
  for ref in $(grep -oE '/assets/[A-Za-z0-9._-]+' "$dir/index.html" | sort -u); do
    [ -s "$dir$ref" ] || die "Release $dir: $ref fehlt"
  done
}

# Readiness im laufenden Container (DB lesbar), nicht nur "Prozess läuft".
health_check() {
  local i
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    if compose exec -T kino-api wget -qO- http://127.0.0.1:3005/api/readyz 2>/dev/null | grep -q '"ok":true'; then return 0; fi
    sleep "$HEALTH_SLEEP"
  done
  return 1
}

# Frontend in den bestehenden Bind-Mount legen: erst Assets/SW (alte gehashte Assets bleiben für offene Clients),
# index.html zuletzt per rename im selben Verzeichnis. -m: mtime = jetzt (für die Asset-Aufbewahrung).
publish_frontend() {
  local src=$1
  mkdir -p "$DIST"
  tar -C "$src" --exclude=index.html --exclude=.migrations -cf - . | tar -C "$DIST" -mxf -
  cp "$src/index.html" "$DIST/.index.html.tmp"
  mv -f "$DIST/.index.html.tmp" "$DIST/index.html"
}

# Code-Rollback nur, wenn die DB keine Migration enthält, die das Ziel nicht kennt und die als "-- contract"
# (nicht rückwärtskompatibel) markiert ist. Unbekannte Datei = nicht prüfbar = Abbruch.
schema_compatible() {
  local target_list=$1 m
  [ -f "$DB" ] || return 0
  for m in $(sqlite3 "$DB" "SELECT name FROM schema_migrations ORDER BY name"); do
    grep -qxF "$m" "$target_list" && continue
    [ -f "$ROOT/backend/migrations/$m" ] || { echo "Migration $m unbekannt - Rollback nicht prüfbar" >&2; return 1; }
    if grep -q '^-- contract' "$ROOT/backend/migrations/$m"; then echo "Migration $m ist nicht rückwärtskompatibel (-- contract)" >&2; return 1; fi
  done
}

set_current() { echo "$1" > "$REL/.current.tmp" && mv -f "$REL/.current.tmp" "$REL/current"; }
