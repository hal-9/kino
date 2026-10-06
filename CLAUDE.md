# LiLief-Kino

Arbeitsgrundlage: `docs/IMPLEMENTATION.md` (vollständiger Bauplan, Meilensteine M1–M5)
und `docs/PLAN.md` (Entscheidungen). Vorlage für Code und Deploy ist `~/einkauf`.

## Regeln

- Erst `docs/IMPLEMENTATION.md` ganz lesen, dann M1. Ein Meilenstein nach dem anderen, jeder endet mit seinen Prüfbefehlen.
- Dateien, die der Plan als „kopieren“ markiert, 1:1 aus `~/einkauf` übernehmen und nur an den genannten Stellen ändern.
- Keine Repos außer `~/kino` ändern. Einzige Ausnahme (M5): `~/workout-app/deploy/Caddyfile` und `~/workout-app/deploy/compose.yml`, nur diese zwei Dateien committen. Niemals `~/workout-app/deploy/deploy.sh` oder `docker compose up -d --build api` im Workout-Stack ausführen.
- Jeder Shell-Befehl für den Nutzer ist mit **[Local]** oder **[VPS]** markiert.
- Keine neuen Abhängigkeiten über die im Plan gelisteten hinaus. Kein Headless-Browser.
- Secrets nur in `deploy/.env` (git-ignored).
- Deutsch im UI, Englisch im Code. Tests mit Vitest + supertest, Fixtures in `backend/test/fixtures/`.
- Vor jedem Commit `npm test` grün.

## Dev

```bash
npm install
npm run dev:backend    # Port 3005, REGISTER_INVITE_CODE=CREW-DEV DATABASE_PATH=./data/dev.db
npm run dev:frontend   # Port 5176, Proxy /api → 3005
npm test
cd backend && npm run sync   # Programm einmal holen
```
