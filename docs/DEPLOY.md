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

## Später: Update ausrollen

```bash
/opt/kino/deploy/deploy.sh
```

## Fallstricke

- `name: kino` und Service `kino-api` sind Pflicht, sonst ersetzt Compose fremde Container.
- `/opt/kino` muss dem Nutzer gehören (`chown`), der Container läuft als `1000:1000`.
- Der Workout-Checkout auf dem VPS ist weiter als die laufenden Container: dort nur `git pull` und Caddy recreate.
