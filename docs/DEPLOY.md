# Deployment auf den VPS

Ziel: `kino.tunikb.com` auf dem Contabo-VPS neben Workout, Dienstplan, Diary,
Paperless und Einkauf. Der Caddy des Workout-Stacks (`/opt/workout/app/deploy`,
Netz `deploy_default`) bleibt der einzige Reverse-Proxy. Kino liefert nur den
API-Container (`kino-api`, Port 3005) plus statische Dateien.

Jeder Befehl ist mit **[Local]** oder **[VPS]** markiert. Schritte mit **[Nutzer]**
macht nur der Nutzer.

## 1. [Local] Repo anlegen und pushen

```bash
cd ~/kino && git remote add origin git@github.com:hal-9/kino.git 2>/dev/null; gh repo create hal-9/kino --private --source . --push
```

## 2. [Local] Deploy-Key für den VPS

```bash
ssh vps 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/kino_deploy -C vps-kino >/dev/null && cat ~/.ssh/kino_deploy.pub' > /tmp/kino_deploy.pub && gh repo deploy-key add /tmp/kino_deploy.pub -R hal-9/kino --title vps
```

## 3. [VPS] SSH-Alias, Verzeichnis, Klonen

```bash
printf '\nHost github.com-kino\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/kino_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```

```bash
sudo mkdir -p /opt/kino && sudo chown $USER:$USER /opt/kino && git clone git@github.com-kino:hal-9/kino.git /opt/kino
```

## 4. [VPS] Env anlegen — **[Nutzer]**

```bash
cp /opt/kino/deploy/.env.example /opt/kino/deploy/.env && nano /opt/kino/deploy/.env
```

`REGISTER_INVITE_CODE` setzen (`openssl rand -hex 6`), optional `TMDB_API_KEY`.

## 5. DNS — **[Nutzer, Cloudflare]**

A-Record `kino` → VPS-IP, **DNS only**.

```bash
dig +short kino.tunikb.com
```

## 6. [Local] Caddy-Block committen

Der Block für `kino.tunikb.com` steht in `~/workout-app/deploy/Caddyfile`
(`reverse_proxy kino-api:3005`, Frontend aus `/srv/kino`) und das Volume
`/opt/kino/deploy/frontend-dist:/srv/kino` in `~/workout-app/deploy/compose.yml`.
Nur diese zwei Dateien committen:

```bash
cd ~/workout-app && git status --short && git add deploy/Caddyfile deploy/compose.yml && git commit -m "Caddy: kino.tunikb.com" && git push
```

## 7. [VPS] Kino bauen und starten

```bash
/opt/kino/deploy/deploy.sh
```

```bash
docker compose -f /opt/kino/deploy/compose.yml ps && docker compose -f /opt/kino/deploy/compose.yml logs --tail 30 kino-api
```

Erwartet: `kino-api` „Up“, nach ca. 15 s im Log `kinoheld: ok …` und je Quelle eine Zeile.

## 8. [VPS] Caddy neu erstellen (Pflicht, `restart` reicht nicht)

Die Caddyfile ist ein Einzeldatei-Bind-Mount; `git pull` legt einen neuen Inode an.

```bash
cd /opt/workout/app && git pull && cd deploy && docker compose up -d --force-recreate caddy && docker compose exec -T caddy grep -c kino /etc/caddy/Caddyfile
```

Erwartet: Zahl ≥ 1. **Nichts anderes in diesem Verzeichnis ausführen**, nie
`deploy.sh` oder `up -d --build api` im Workout-Stack. Danach:

```bash
docker compose ps
```

`deploy-api-1` und `deploy-caddy-1` „Up“, Workout-Login im Browser kurz prüfen.

## 9. [Local] Smoke-Test

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://kino.tunikb.com/api/healthz
```

Erwartet `200`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://kino.tunikb.com/api/program?q=a'
```

Erwartet `401` (Auth greift).

## 10. Gruppe einladen — **[Nutzer]**

Safari: registrieren (Invite-Code), „Zum Home-Bildschirm“, Einstellungen →
Kalender abonnieren (Tipp auf den Link), Letterboxd-Namen eintragen. Invite-Code
an Kim, Meri, Daniel, Micha.

## 11. [VPS] Backup

```bash
crontab -e
```

Zeile: `25 3 * * * /opt/kino/deploy/backup.sh >> /opt/kino/backup.log 2>&1`

```bash
/opt/kino/deploy/backup.sh && ls /opt/kino/backups
```

`backup.sh` schreibt eine eigenständige Datei (kein WAL) und prüft sie mit `deploy/verify-backup.sh`
(integrity_check, foreign_key_check, schema_migrations). Fehlende DB oder kaputtes Backup → Exit ≠ 0 und
`FEHLER:` im Log. Einzelnes Backup prüfen (**[VPS]**):

```bash
/opt/kino/deploy/verify-backup.sh /opt/kino/backups/<datei>.db
```

Stand und Grenzen (K25, 2026-10-06):

- Datenverlust-Fenster nach Zeitplan: bis ~24 h (nächtlich 03:25) bzw. seit dem letzten `pre-<sha>`-Backup.
  Nicht gemessen auf dem VPS.
- Wiederherstellung lokal geprobt (Kopie von `backend/data/dev.db`, sanitisiert/Dev-Daten): Backup + Prüfung +
  Kopie + Migrationen 005–012 + App-Start mit `/api/readyz` 200 in 0,33 s; integrity ok, 0 FK-Verstöße,
  6989 Vorstellungen, 4 Optionen, 1 Besuch. Restore auf dem VPS: **nicht ausgeführt** (Owner-Freigabe nötig).
- **Off-Host-Kopie: blockiert.** Kein freigegebenes Ziel, keine Zugangsdaten, kein Schlüssel beim Owner.
  Bis dahin liegen Backups nur auf demselben VPS (Ausfall des VPS = Verlust). Nötig vom Owner: Ziel
  (z. B. Storage-Box), Verschlüsselung (z. B. age-Empfängerschlüssel, privater Schlüssel nur beim Owner),
  Aufbewahrung, dann Upload + Probe-Entschlüsselung.
- Restore auf dem VPS (nur mit Freigabe; verliert alle Schreibvorgänge seit dem Backup):
  API stoppen, `data/app.db` (+ `-wal`/`-shm`) beiseite legen, Backup als `data/app.db` kopieren,
  `chown 1000:1000`, API mit dem Tag aus `deploy/releases/current` starten, `/api/readyz` prüfen.

## 12. UCI und berlin.de vom Mac (Pflicht, beide blocken den VPS mit 403)

`tools/inbox-sync.sh` holt beide Seiten lokal, prüft sie, legt sie in
`/opt/kino/data/inbox` ab und stößt den Sync im Container an. Der Sync nimmt
Inbox-Dateien unter 36 h vor dem Live-Abruf. Einmal von Hand testen (**[Local]**):

```bash
~/kino/tools/inbox-sync.sh
```

Erwartet im Ende des Logs: `uci: ok …`, `berlinde: ok …`. Dann täglich 07:40 per launchd (**[Local]**):

```bash
cp ~/kino/tools/com.tuncay.kino-inbox.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tuncay.kino-inbox.plist
```

Log: `~/Library/Logs/kino-inbox.log`. Ist der Mac mehrere Tage aus, fallen UCI und
Alhambra nach 36 h auf den Live-Abruf (403) zurück; Zeiten kommen dann weiter von kinoheld,
nur Fassung/Saal fehlen, und die Einstellungen zeigen „veraltet“.

Jede Seite wird für sich geholt, geprüft und atomar veröffentlicht (Upload als `.name.tmp`, dann
`mv`); fällt eine aus, kommt die andere trotzdem an (Exit-Code ≠ 0 meldet den Teilausfall).
`scp -p` erhält die mtime: der Sync führt sie als Capture-Zeit (`last_captured_at`), nicht die Importzeit.

## Sync-Betrieb und Frische

- Takt: Server-Sync 15 s nach Start, dann alle 12 h; Mac-Inbox täglich 07:40 (+ sofortiger Sync).
  Inbox-Dateien gelten 36 h. „Veraltet“ in der App = letzter Erfolg einer Quelle älter als 36 h.
- Ein Schreiber: Server-Timer und `run.js` (CLI/Mac) teilen sich eine Lease in `sync_lease`
  (15 min, Heartbeat vor jedem Abruf, Prüfung in jeder Import-Transaktion). Läuft schon ein Sync,
  meldet der zweite „übersprungen“. Ein abgestürzter Lauf blockiert höchstens 15 min.
- Abwesende Vorstellungen werden nur bei vollständig gemeldeten Quellen (kinoheld, Zoo Palast) und
  nach zwei verschiedenen Captures mit ≥ 6 h Abstand zurückgezogen (nicht gelöscht).
- `GET /api/healthz` = Prozess lebt, `GET /api/readyz` = DB lesbar (503 sonst). Beide öffentlich und ohne
  Details; Quellen-Zeitpunkte und Fehler nur angemeldet unter `/api/sources`.

## Kalender-Links (ab Migration 011)

- Der Link in den Einstellungen ist eine Inhaber-Berechtigung für alle gebuchten Termine des Haushalts.
- Neue Links liegen nur als SHA-256 in `cal_tokens` und werden nur direkt nach dem Erzeugen angezeigt.
  Standard: ohne Ticket-Links (Opt-in per Checkbox).
- Bestehende Alt-Links (Klartext, `hashed = 0`) laufen unverändert weiter, inkl. Ticket-Links, bis der Nutzer
  „Neuen Link erzeugen“ oder „Link widerrufen“ tippt. Kein stilles Abklemmen laufender Abos.
- Nach Rotation ist der alte Link sofort ungültig (404). Kalender-Dienste behalten bereits geladene Termine;
  das lässt sich serverseitig nicht zurückholen. UIDs (`proposal-<id>@…`) bleiben gleich.

## Später: Update ausrollen — **[Nutzer-Freigabe]**

```bash
/opt/kino/deploy/deploy.sh
```

Ablauf (`deploy/deploy.sh`, Hilfsfunktionen in `deploy/lib.sh`):

1. `git pull --ff-only`, Frontend im Node-Container bauen, nach `deploy/releases/<sha>/` kopieren und prüfen
   (index.html + alle referenzierten `/assets/` vorhanden), Liste der Migrationen als `.migrations` dazulegen.
   API-Image als `kino-api:<sha>` bauen. Bis hier ist Live unberührt; Fehler → Abbruch, nichts geändert.
2. `deploy/backup.sh pre-<sha>` (Migrationen laufen beim API-Start).
3. API auf `kino-api:<sha>` umschalten, `/api/readyz` im Container abfragen (bis 60 s).
   Nicht bereit → `rollback.sh <vorheriges>` automatisch, Exit ≠ 0.
4. Erst dann Frontend in den bestehenden Bind-Mount `deploy/frontend-dist` legen: Assets zuerst, `index.html`
   zuletzt per rename. Das Verzeichnis selbst wird nie gelöscht (Caddy hält den Inode). Alte gehashte Assets
   bleiben 14 Tage für offene Clients liegen; die letzten 5 Releases bleiben in `deploy/releases/`.

`docker compose up -d` ohne `KINO_API_TAG` startet `kino-api:latest`; für Handarbeit immer das Tag aus
`deploy/releases/current` setzen: `KINO_API_TAG=$(cat /opt/kino/deploy/releases/current) docker compose up -d kino-api`.

## Rollback — **[Nutzer-Freigabe]**

```bash
/opt/kino/deploy/rollback.sh <sha>
```

Nur Code-Rollback (API-Image + Frontend des Releases). Die Datenbank wird **nicht** zurückgespielt: ein Restore
verliert alle Schreibvorgänge seit dem Backup und ist eine bewusste Einzelentscheidung (`backups/app_*_pre-<sha>.db`).
Migrationen sind expand-only (additiv); eine nicht rückwärtskompatible Migration muss die Zeile `-- contract`
enthalten. Kennt das Ziel-Release eine angewandte `-- contract`-Migration nicht, bricht `rollback.sh` ab.

Lokal geprüft nur isoliert (`backend/test/deploy.test.js`: git/docker als Stubs, ssh/scp/curl blockiert,
Temp-`KINO_ROOT`). Auf dem VPS bisher **nicht ausgeführt**.

## Fallstricke

- `name: kino` und Service `kino-api` sind Pflicht, sonst ersetzt Compose fremde Container.
- `/opt/kino` muss dem Nutzer gehören (`chown`), der Container läuft als `1000:1000`.
- Der Workout-Checkout auf dem VPS ist weiter als die laufenden Container: dort nur `git pull` und Caddy recreate.
