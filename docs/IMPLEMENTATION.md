# LiLief-Kino – Implementierungsplan (Handover)

Stand: 2026-10-06. Dieses Dokument ist vollständig: wer es von oben nach unten
abarbeitet, hat am Ende eine laufende App unter `https://kino.tunikb.com`,
neben Workout, Dienstplan, Diary, Paperless und Einkauf auf demselben VPS, ohne
eine der bestehenden Apps anzufassen (Ausnahme: zwei Zeilen-Blöcke in
`~/workout-app/deploy/`, siehe M5).

Hintergrund und Entscheidungen: `docs/PLAN.md`. Bei Widerspruch gilt dieses Dokument.

---

## 0. Arbeitsregeln für das umsetzende Modell

1. **Erst alles lesen, dann M1 beginnen.** Ein Meilenstein nach dem anderen, jeder endet mit den angegebenen Prüfbefehlen. Erst weiter, wenn sie grün sind.
2. **Vorlage ist `~/einkauf`.** Dateien, die hier als „kopieren“ markiert sind, werden 1:1 aus `~/einkauf` übernommen und nur an den genannten Stellen geändert. Nichts „verbessern“.
3. **Nie in anderen Repos arbeiten**, außer den zwei genannten Änderungen in `~/workout-app/deploy/Caddyfile` und `~/workout-app/deploy/compose.yml` (M5). Dort nur diese zwei Dateien `git add`-en. Niemals `~/workout-app/deploy/deploy.sh` ausführen, niemals `docker compose up -d --build api` im Workout-Stack.
4. **Jeder Shell-Befehl trägt `[Local]` oder `[VPS]`.** VPS = `ssh vps` (tuncay@vmd188662). Auf dem VPS nur Befehle aus diesem Dokument.
5. **Keine Secrets ins Repo**: `deploy/.env` ist git-ignored, Invite-Code und TMDB-Key stehen nur dort.
6. **Keine neuen Abhängigkeiten** außer den in §2 gelisteten. Kein Headless-Browser, kein Cheerio, kein ical-Paket: HTML wird mit RegExp geparst, ICS ist ein String-Template.
7. **Deutsch im UI, Englisch im Code.** Kommentare kurz, nur wo ein Warum nicht aus dem Code hervorgeht.
8. **Stop-Punkte**: Schritte, die der Nutzer selbst machen muss (DNS, Repo anlegen, `.env` befüllen), sind mit **[Nutzer]** markiert. Dort anhalten, den Befehl zeigen, auf Bestätigung warten.
9. Vor jedem Commit: `npm test` grün. Commit-Messages: `M1: …`, `M2: …`.

---

## 1. Zielbild

- **Programm**: „Welches Kino zeigt Film X wann, in welcher Fassung (OV/OmU/OmeU/DF), in welchem Saal?“ Favoriten zuerst (Delphi LUX, Zoo Palast, Cineplex Alhambra, UCI Luxe Mercedes Platz, City Kino Wedding), alle anderen Berliner Kinos als „Weitere Kinos“.
- **Vorschläge**: Film + 2–5 Vorstellungen vorschlagen, Gruppe stimmt ab (✓ / ? / ✗), eine Option wird „Gebucht“, daraus `.ics` und ein Kalender-Abo.
- **Besuche**: nach dem Kino Saal/Reihe/Sitz und Begleitung eintragen, Button in die Letterboxd-App, Rating später per RSS zurücklesen.
- **Wrapped**: Jahresstatistik.
- Gruppe: Tuncay, Kim, Meri, Daniel, Micha. Registrierung per Invite-Code, wie Einkauf.

---

## 2. Stack und Repo-Layout

Identisch zu Einkauf: npm workspaces, React 18 + Vite 5 PWA, Express 4 + better-sqlite3, Vitest + supertest.

```
~/kino
├── package.json                 workspaces: shared, backend, frontend (kopieren, name "kino")
├── .gitignore                   kopieren
├── CLAUDE.md                    Arbeitsregeln (liegt schon da)
├── README.md
├── docs/PLAN.md, docs/IMPLEMENTATION.md, docs/DEPLOY.md
├── shared/                      package.json (kopieren) + normalize.js (+ Test)
├── backend/
│   ├── package.json             kopieren, Deps: bcrypt, better-sqlite3, cookie-parser, express,
│   │                            express-rate-limit, shared, zod · dev: supertest, vitest
│   ├── Dockerfile               kopieren, EXPOSE 3005
│   ├── migrations/001_init.sql
│   ├── data/cinemas.json        Favoriten-Stammdaten (§4)
│   ├── src/
│   │   ├── server.js app.js db.js migrate.js auth.js accounts.js   (kopieren, §3)
│   │   ├── routes/auth.js program.js proposals.js visits.js calendar.js stats.js
│   │   ├── sync/index.js        Orchestrierung: Quellen → merge → upsert → source_health
│   │   ├── sync/kinoheld.js yorck.js zoopalast.js uci.js berlinde.js
│   │   ├── sync/run.js          `npm run sync` (einmal, dann exit)
│   │   ├── letterboxd.js        RSS-Abgleich
│   │   ├── tmdb.js              optional (ohne Key No-Op)
│   │   └── ics.js
│   └── test/                    helpers.js (kopieren), fixtures/, *.test.js
├── frontend/                    kopieren: vite.config.js, index.html, src/main.jsx, src/api.js,
│                                src/index.css, components/{Header,BottomNav,Sheet,Logo}.jsx,
│                                screens/{Login,Register}.jsx; neu: screens/{Programm,Vorschlaege,Besuche,Wrapped,Einstellungen}.jsx
└── deploy/                      compose.yml, deploy.sh, backup.sh, .env.example (kopieren + anpassen, §M5)
```

Ports: Backend **3005**, Vite **5176** (3000 Workout, 3001 Workout-Dev, 3002 Dienstplan, 3003 Diary, 3004 Einkauf, 5173–5175 vergeben).

---

## 3. Auth und Gruppe (kopieren aus Einkauf)

Kopieren ohne Änderung: `backend/src/auth.js`, `accounts.js`, `db.js`, `migrate.js`, `routes/auth.js`, `test/helpers.js` (dort `offersDb`/`classify`/`matchLlm` entfernen), `app.js` als Skelett (Router austauschen).

Die Tabellen heißen weiter `households` / `household_members` (weniger Diff, weniger Fehler). Haushalt 1 heißt `'Kino-Crew'`. Im UI wird „Haushalt“ nie angezeigt, nur „Gruppe“.

`app.js`-Abweichungen: `express.json({ limit: '64kb' })` (Snapshot-JSON der Vorschläge), Router: `authRouter, programRouter, proposalsRouter, visitsRouter, calendarRouter, statsRouter`. Alles unter `/api`. Der Kalender-Feed liegt unter `/api/cal/:token.ics`, damit Caddy keine zusätzliche Regel braucht.

---

## 4. Datenmodell

`backend/migrations/001_init.sql`:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
  password_digest TEXT NOT NULL, letterboxd_user TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE households (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO households (id, name) VALUES (1, 'Kino-Crew');
CREATE TABLE household_members (
  household_id INTEGER NOT NULL REFERENCES households(id), user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (household_id, user_id)
);

-- Stammdaten. key = stabiler Slug (z. B. 'delphi-lux'), Seed aus data/cinemas.json + kinoheld.
CREATE TABLE cinemas (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, chain TEXT, street TEXT, zip TEXT, city TEXT DEFAULT 'Berlin',
  lat REAL, lng REAL, is_favorite INTEGER NOT NULL DEFAULT 0, kinoheld_id INTEGER,
  aliases_json TEXT NOT NULL DEFAULT '[]',        -- Namen, unter denen Quellen dieses Kino führen
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE auditoriums (
  cinema_key TEXT NOT NULL REFERENCES cinemas(key), name TEXT NOT NULL,
  seats INTEGER, screen_width_m REAL, favorite_row TEXT, PRIMARY KEY (cinema_key, name)
);
CREATE TABLE movies (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, norm_title TEXT NOT NULL, title_original TEXT, year INTEGER,
  runtime INTEGER, tmdb_id INTEGER, poster_url TEXT, original_language TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (norm_title, year)
);
CREATE TABLE screenings (
  id INTEGER PRIMARY KEY, cinema_key TEXT NOT NULL REFERENCES cinemas(key), movie_id INTEGER NOT NULL REFERENCES movies(id),
  starts_at TEXT NOT NULL,                        -- ISO mit Offset, z. B. 2026-10-13T20:15:00+02:00
  version TEXT CHECK (version IN ('OV','OmU','OmeU','DF') OR version IS NULL),
  auditorium TEXT, attrs_json TEXT NOT NULL DEFAULT '[]', ticket_url TEXT,
  source TEXT NOT NULL, source_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cinema_key, movie_id, starts_at)
);
CREATE INDEX screenings_time ON screenings (starts_at);
CREATE INDEX screenings_movie ON screenings (movie_id, starts_at);
CREATE TABLE source_health (
  source TEXT PRIMARY KEY, last_ok_at TEXT, last_error TEXT, last_error_at TEXT, last_count INTEGER
);

CREATE TABLE proposals (
  id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
  movie_id INTEGER NOT NULL REFERENCES movies(id), created_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled')),
  booked_option_id INTEGER, booked_by INTEGER REFERENCES users(id), booked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE proposal_options (
  id INTEGER PRIMARY KEY, proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  screening_id INTEGER REFERENCES screenings(id),
  snapshot_json TEXT NOT NULL                     -- {cinema_key, cinema_name, street, zip, lat, lng, starts_at, version, auditorium, ticket_url, title, year, runtime}
);
CREATE TABLE votes (
  option_id INTEGER NOT NULL REFERENCES proposal_options(id), user_id INTEGER NOT NULL REFERENCES users(id),
  value TEXT NOT NULL CHECK (value IN ('yes','maybe','no')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (option_id, user_id)
);
CREATE TABLE visits (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), household_id INTEGER NOT NULL REFERENCES households(id),
  proposal_id INTEGER REFERENCES proposals(id), movie_id INTEGER REFERENCES movies(id),
  snapshot_json TEXT NOT NULL,                    -- wie proposal_options.snapshot_json
  watched_on TEXT NOT NULL,                       -- YYYY-MM-DD
  auditorium TEXT, row TEXT, seats TEXT, companions_json TEXT NOT NULL DEFAULT '[]',
  letterboxd_rating REAL, letterboxd_synced_at TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE cal_tokens (user_id INTEGER PRIMARY KEY REFERENCES users(id), token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
```

### `backend/data/cinemas.json` (Favoriten)

Beim Start (`server.js`, nach den Migrationen) und bei `npm run sync` wird die Datei in `cinemas`/`auditoriums` ge-upsertet. Adresse, Koordinaten und Säle für die Favoriten holt M1 aus kinoheld bzw. der Zoo-Palast-Config (Befehle in §5); Leinwandbreite und Lieblingsreihe bleiben `null`, bis der Nutzer sie einträgt (kinokompendium.de hat die Werte).

```json
[
  { "key": "delphi-lux", "name": "Delphi LUX", "chain": "yorck", "kinoheld_id": 2118, "is_favorite": true,
    "aliases": ["delphi LUX", "Delphi LUX"], "sources": { "yorck": "delphi LUX" },
    "auditoriums": [ { "name": "Kino 1" }, { "name": "Kino 2" }, { "name": "Kino 3" }, { "name": "Kino 4" }, { "name": "Kino 5" }, { "name": "Kino 6" }, { "name": "Kino 7" } ] },
  { "key": "zoo-palast", "name": "Zoo Palast", "chain": "premiumkino", "kinoheld_id": 1328, "is_favorite": true,
    "aliases": ["Zoo Palast"], "sources": { "zoopalast": true }, "auditoriums": [] },
  { "key": "cineplex-alhambra", "name": "Cineplex Alhambra", "chain": "cineplex", "kinoheld_id": 317, "is_favorite": true,
    "aliases": ["Cineplex Alhambra", "Alhambra"], "sources": { "berlinde": 34187 }, "auditoriums": [] },
  { "key": "uci-mercedes-platz", "name": "UCI Luxe Mercedes Platz", "chain": "uci", "kinoheld_id": 2213, "is_favorite": true,
    "aliases": ["UCI Kinowelt Berlin - Mercedes Platz | Luxe", "Berlin - East Side Gallery | Luxe"],
    "sources": { "uci": { "slug": "berlin-mercedes-platz", "id": 82 } }, "auditoriums": [] },
  { "key": "city-kino-wedding", "name": "City Kino Wedding", "chain": null, "kinoheld_id": 3305, "is_favorite": true,
    "aliases": ["City Kino Wedding Berlin", "City Kino Wedding Berlin alt"], "sources": {}, "auditoriums": [] }
]
```

Die Säle von Zoo Palast kommen aus dessen Config (`cinema.auditoriums[]: {id, name:"Kino 1", seatTotal:773}`), die Säle von Delphi LUX sind oben hart gesetzt (Yorck liefert keinen Saal pro Vorstellung; Namen am Haus prüfen und ggf. korrigieren). Alle anderen Kinos (zweite Reihe) entstehen automatisch aus kinoheld mit `key = slugify(name)`.

---

## 5. Datenquellen und Adapter

Jeder Adapter exportiert `async function fetchShows(ctx) → Row[]` mit

```js
// Row
{ cinemaKey, cinemaName, startsAt /* ISO mit Offset Europe/Berlin */, title, year /* int|null */,
  version /* 'OV'|'OmU'|'OmeU'|'DF'|null */, auditorium /* string|null */, attrs /* string[] */,
  ticketUrl /* string|null */, source /* 'kinoheld'|'yorck'|'zoopalast'|'uci'|'berlinde' */, sourceId /* string|null */,
  runtime /* int|null */ }
```

`ctx = { fetch, log, cinemas /* Map key→cinema aus DB */, today }`. Jeder Adapter wirft bei HTTP ≠ 200 oder unplausibel wenigen Zeilen (`< MIN_ROWS`, pro Quelle unten) einen Fehler; der Orchestrator fängt ihn, schreibt `source_health.last_error` und lässt die bisherigen Zeilen dieser Quelle stehen.

Gemeinsame Header: `user-agent: LiLief-Kino/1.0 (private use; tuncay)`, `accept: application/json` bzw. `text/html`. Zwischen Requests 300 ms Pause. Timeout 20 s (`AbortSignal.timeout`).

Zeitzone: Alle Quellen liefern Berliner Lokalzeit. In ISO mit Offset umwandeln, ohne Bibliothek:

```js
// shared/normalize.js
export function berlinIso(dateYmd, hhmm) {            // '2026-10-13','20:15' → '2026-10-13T20:15:00+02:00'
  const [y, m, d] = dateYmd.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d, 12))  // Mittag, um DST-Grenzen zu vermeiden
  const offMin = -berlinOffsetMinutes(probe)          // Intl-basiert, siehe unten
  const sign = offMin <= 0 ? '+' : '-'; const a = Math.abs(offMin)
  return `${dateYmd}T${hhmm}:00${sign}${String(a / 60 | 0).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}
export function berlinOffsetMinutes(date) {           // Minuten, die UTC hinter Berlin liegt (negativ = Berlin voraus)
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(date).find(p => p.type === 'timeZoneName').value // 'GMT+2'
  const m = /GMT([+-]\d+)/.exec(s); return m ? -Number(m[1]) * 60 : 0
}
export function normTitle(t) {
  return String(t).toLowerCase()
    .replace(/\((ov|omu|omeu|df|2d|3d|\d{4})\)/g, ' ').replace(/\b(ov|omu|omeu|df)\b/g, ' ')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}
export function slugify(name) { return normTitle(name).replace(/\s+/g, '-') }
export function versionFromLanguages(audio, subtitle) {   // Namen wie 'Deutsch','English','Englisch','Korean'
  const isDe = (s) => /^(de|deutsch|german)/i.test(s || '')
  const isEn = (s) => /^(en|englisch|english)/i.test(s || '')
  if (!audio && !subtitle) return null
  if (isDe(audio) && !subtitle) return 'DF'
  if (subtitle && isDe(subtitle)) return 'OmU'
  if (subtitle && isEn(subtitle)) return 'OmeU'
  if (audio && !isDe(audio) && !subtitle) return 'OV'
  return subtitle ? 'OmU' : null
}
```

Tests für `normTitle`, `berlinIso` (Sommer- und Winterzeit), `versionFromLanguages` in `shared/normalize.test.js`.

### 5.1 kinoheld (Basis, alle Kinos) — `sync/kinoheld.js`

`POST https://next-live.kinoheld.de/graphql`, Header zusätzlich `content-type: application/json`, `origin: https://www.kinoheld.de`. Kein Key. Max. 100 Einträge pro Seite, `paginatorInfo.hasMorePages` auswerten.

Kinos (einmal pro Sync, upsert in `cinemas`, `is_favorite` nicht überschreiben):

```graphql
{ cinemas(proximity:{city:"Berlin", distance:25}, first:100, page:1) {
    paginatorInfo { hasMorePages }
    data { id name urlSlug street postcode { postcode } city { name } latitude longitude auditoriumCount seatCount isBookable } } }
```

Säle eines Kinos (nur für Favoriten mit `kinoheld_id`, upsert in `auditoriums.seats`):

```graphql
{ cinema(id: 3305) { auditoriums(first: 30) { data { id name seatCount } } } }
```

Vorstellungen, pro Tag für heute + 13 Tage, Seiten bis `hasMorePages=false`:

```graphql
{ programShows(cinemaProximity:{city:"Berlin", distance:25}, dates:["2026-10-06"], first:100, page:1) {
    paginatorInfo { hasMorePages }
    data { id beginning urlSlug isBookable auditorium { name seatCount } audioLanguage { name } subtitleLanguage { name }
           flags { category name } cinema { id name } movie { id title titleOriginal productionYear duration } } } }
```

Mapping:
- `cinemaKey`: Kino mit `kinoheld_id == cinema.id`, sonst `slugify(cinema.name)` (neues Kino anlegen, `chain` aus Namenspräfix CineStar/Cineplex/CinemaxX/UCI/Yorck, sonst null).
- `startsAt = beginning` (hat schon Offset). `title = movie.title`, `year = Number(productionYear) || null`, `runtime = duration`.
- `version`: `versionFromLanguages(audioLanguage?.name, subtitleLanguage?.name)`; wenn null, aus `flags` mit `category=='LANGUAGE'`: `name=='OV'||name=='en'` → OV, `'subtitled OV'` → OmeU wenn `subtitleLanguage` fehlt (Erfahrungswert Berlin-Indies), `'OmeU'` → OmeU, `'OmU'` → OmU. Sonst null (unbekannt, Overlay darf füllen).
- `auditorium`: `auditorium.name`, aber **null**, wenn das Kino kein kinoheld-Buchungspartner ist: Platzhalter sind `'Saal 1'`/`'Auditorium'` mit `seatCount == null` bei Kinos, deren `isBookable` false ist. Regel: `auditorium = (auditorium?.seatCount != null) ? auditorium.name : null`.
- `attrs`: Flag-Namen mit `category in ('TECHNOLOGY','EVENT')` (IMAX, Atmos, D-BOX, ScreenX …).
- `ticketUrl`: `https://www.kinoheld.de/kino/berlin/<cinema.urlSlug>/vorstellung/<show.id>` nur wenn `isBookable`, sonst null. (Slug über die Kinoliste merken.)
- `MIN_ROWS = 300` (Berlin hat ~750 Vorstellungen pro Tag; über 14 Tage ≥ 3000).

Erwartete Größen (verifiziert 2026-10-06): 134 Kinos, 755 Vorstellungen am Tag, ~75 Kinos mit Programm.

### 5.2 Yorck (Delphi LUX + 13 Häuser) — `sync/yorck.js`

`GET https://www.yorck.de/filme` (HTML, ~2,6 MB). Aus dem HTML den JSON-Block `<script id="__NEXT_DATA__" type="application/json">…</script>` ziehen und parsen. Pfad: `props.pageProps.films[]` und `props.pageProps.specials[]`, je `fields`:

```json
{ "title": "Alte Liebe", "vistaId": "HO00006069", "runtime": 111, "slug": "alte-liebe", "releaseDate": "…",
  "sessions": [ { "sys": { "id": "1013-6152" }, "fields": { "startTime": "2026-10-13T14:45:00+01:00", "formats": ["OmU"],
                  "cinema": { "fields": { "name": "Delphi Filmpalast" } } } } ] }
```

- `startsAt = startTime`. **Achtung**: Yorck schreibt im Oktober `+01:00`, obwohl Sommerzeit ist (so im Payload gesehen). Deshalb Offset verwerfen und mit `berlinIso(date, time)` aus den lokalen Anteilen neu bauen.
- `version` aus `formats`: enthält `OmeU` → OmeU, sonst `OmU` → OmU, sonst `OV` → OV, sonst `DF` → DF, sonst null. Übrige Formate (`SV`, `Festival`, `Premiere`, `Mongay` …) → `attrs`.
- `cinemaKey`: Kino, dessen `aliases` den Namen enthalten (für Favoriten), sonst `slugify(name)`. Yorck-Namen (verifiziert): Passage, Babylon Kreuzberg, Yorck, delphi LUX, Kant Kino, Kino International, Filmtheater am Friedrichshain, Cinema Paris, Rollberg, Delphi Filmpalast, Capitol Dahlem, Odeon, Neues Off, Blauer Stern (mit Leerzeichen am Ende → trimmen).
- `ticketUrl = https://www.yorck.de/filme/<slug>`; `year` null; `runtime` aus `runtime`.
- `MIN_ROWS = 150`. Erwartet ~680 Sessions über ~4 Wochen.

### 5.3 Zoo Palast — `sync/zoopalast.js`

Header zusätzlich `origin: https://zoopalast.premiumkino.de`, `referer: https://zoopalast.premiumkino.de/`.

1. `GET https://backend.premiumkino.de/v1/de/zoopalast/config` → `cinema.auditoriums[]: { id, name: "Kino 1", seatTotal: 773 }` → Map id→name, zusätzlich upsert in `auditoriums` (`seats = seatTotal`). Verifiziert: 7 Säle, Kino 1 = 773 Plätze (größter dauerhaft bespielter Saal Berlins).
2. `GET https://backend.premiumkino.de/v1/de/zoopalast/program` → `{ movies: [...], performances: [...] }`.

```json
// performance
{ "id": "cQRA…", "movieId": "iHV4…", "auditoriumId": "Kqzh…", "cinemaDay": "2026-10-07T00:00:00.000",
  "begin": "2026-10-07T19:50:00.000", "end": "2026-10-07T22:15:00.000", "title": "Adams Acht", "slug": "adams-acht",
  "bookable": true, "workload": 40, "language": "Sprache: Deutsch" }
// movie
{ "id": "iHV4…", "name": "Adams Acht", "slug": "adams-acht", "minutes": 124, "year": 2026 }
```

- `startsAt = berlinIso(begin.slice(0,10), begin.slice(11,16))` (kein Offset im Payload, Lokalzeit).
- `version` aus `language`: `/Sprache:\s*([^,]+)(?:,\s*Untertitel:\s*(.+))?/` → `versionFromLanguages(audio, subtitle)`. Beispiele: `"Sprache: Englisch"` → OV, `"Sprache: Koreanisch, Untertitel: Englisch"` → OmeU, `"Sprache: Französisch, Untertitel: Deutsch"` → OmU, `"Sprache: Deutsch"` → DF.
- `auditorium` = Name aus der Map. `attrs`: `workload >= 80` → `"fast ausverkauft"`. `ticketUrl = https://zoopalast.premiumkino.de/film/<slug>`. `year`, `runtime` aus movie.
- `cinemaKey = 'zoo-palast'`. `MIN_ROWS = 50`. Erwartet ~280 Vorstellungen über ~5 Wochen.

### 5.4 UCI Luxe Mercedes Platz — `sync/uci.js`

`GET https://www.uci-kinowelt.de/kinoprogramm/berlin-mercedes-platz/82` (HTML, ~1,8 MB, serverseitig gerendert, gesamtes Programm auf einer Seite).

Struktur: pro Film ein Block mit

```html
<h2 class="film-container__description__text__eventtitle"><a href="/film/avengers-doomsday/386930/berlin-east-side-gallery/82">Avengers: Doomsday</a></h2>
…
<a href="https://buchung.uci-kinowelt.de/?perf_id=45BF…&amp;site_id=82" class="badge badge-performance …"
   data-time="17:15" data-date="20261216" data-version="ov|isens|2d|706" data-tracking-auditorium="Kino 02 iSense"
   data-tracking-film-id="386930">
```

Parsing (RegExp, kein DOM): zuerst alle Film-Titel mit Film-ID aus den `eventtitle`-Links (`/film/[^/]+/(\d+)/…">([^<]+)<`), dann alle `badge-performance`-Anker; Zuordnung über `data-tracking-film-id`. HTML-Entities (`&amp;`) im Ticketlink dekodieren.

- `startsAt = berlinIso('YYYY-MM-DD' aus data-date, data-time)`.
- `version` aus `data-version`-Tokens: `ov` → OV, `omu` → OmU, `omeu` → OmeU, sonst DF (UCI zeigt deutsche Fassungen ohne Token). Übrige Tokens → `attrs` (`isens` → `iSense`, `imax`, `3d`, `4dx`; rein numerische Tokens ignorieren).
- `auditorium = data-tracking-auditorium`. `ticketUrl` = href. `cinemaKey = 'uci-mercedes-platz'`.
- `MIN_ROWS = 50`. Erwartet ~600 Vorstellungen, ~75 Filme.

### 5.5 Cineplex Alhambra via berlin.de — `sync/berlinde.js`

cineplex.de blockt alles, was kein Browser ist (Cloudflare 403, auch für Node-`fetch`). Deshalb berlin.de:

`GET https://www.berlin.de/kino/_bin/kinodetail.php/34187/` (HTML, ~85 kB).

```html
<span class="js-accordion__trigger">Always Lalisa (OmU)</span>
…
<tr><td>Mo, 12.10.26</td><td>20:00 (OmU)</td></tr>
<tr><td>Mi, 14.10.26</td><td>20:00 (OmU)</td></tr>
```

Parsing: Block pro `<li>` ab „Filme im Cineplex Alhambra“; Titel aus `js-accordion__trigger`; Zeilen `<td>Xx, DD.MM.YY</td><td>HH:MM( \((OmU|OV|OmeU)\))?</td>`.

- Jahr: `20` + YY. `startsAt = berlinIso(…)`.
- `version`: Marker in der Zeit-Zelle, sonst im Titel (`(OmU)`/`(OV)`/`(OmeU)`), sonst **DF** (berlin.de markiert nur Originalfassungen).
- Titel ohne Marker speichern. `auditorium = null`. `ticketUrl = https://www.cineplex.de/berlin-alhambra/programm/`.
- `cinemaKey = 'cineplex-alhambra'`. `MIN_ROWS = 20`.

Zweite Reihe später (nicht in M1, Doku für danach): CinemaxX `GET https://www.cinemaxx.de/api/microservice/showings/cinemas/1107/films?showingDate=YYYY-MM-DDT00:00:00&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true` (`result[].showingGroups[].sessions[]` mit `screenName`, `attributes[attributeType=='Language'].name` Deutsch/Englisch, `startTime` lokal) und CineStar `GET https://www.cinestar.de/api/cinema/<3|5|6|9>/show/?appVersion=1.5.3` (`[].showtimes[]` mit `datetime "2026-10-06 20:10 CEST"`, `attributes` `AUDIO_OV|AUDIO_OmU|AUDIO_OmeU`).

### 5.6 Merge und Upsert — `sync/index.js`

```
runSync(db):
  1. kinoheld.cinemas → upsert cinemas (nicht: is_favorite, aliases, sources)
  2. cinemas.json → upsert (gewinnt bei name/aliases/is_favorite), auditoriums upsert
  3. rows = []; für jede Quelle in [kinoheld, yorck, zoopalast, uci, berlinde]:
       try { r = await fetchShows(ctx); if (r.length < MIN_ROWS) throw …; rows.push(...r); health ok(count) }
       catch (e) { health error(e.message); log; weiter }
  4. in einer Transaktion:
       für jede Row: movie = upsert movies by (normTitle(title), year)  -- year null erlaubt; bei Treffer ohne year, aber neuem year → year setzen
       key = (cinemaKey, movie.id, starts_at auf Minute)
       bestehend?  → update: version = COALESCE(overlay.version, alt), auditorium = COALESCE(overlay, alt),
                              attrs = union, ticket_url = overlay ?? alt, last_seen_at = now
                     (Overlay-Quellen yorck/zoopalast/uci/berlinde gewinnen gegen kinoheld bei version/auditorium)
       neu?        → insert, source = Quelle
  5. Vorstellungen mit last_seen_at < now-36h UND starts_at > now UND Quelle in diesem Lauf ok → DELETE
     (Quelle war erreichbar und listet sie nicht mehr = abgesetzt). Quelle nicht ok → stehen lassen.
  6. tmdb.enrich(db) für movies ohne tmdb_id (max 30 pro Lauf, nur mit TMDB_API_KEY)
  7. letterboxd.syncRatings(db) (§8)
```

Matching-Schlüssel ist `(cinema_key, movie_id, starts_at)`; weil Titel zwischen Quellen leicht abweichen können („Digger“ vs „Digger (2026)“), läuft `normTitle` vorher, und bei Overlay-Zeilen ohne Treffer wird zusätzlich nach `(cinema_key, starts_at)` mit `movies.norm_title` ähnlich gesucht: gleiche ersten 12 Zeichen von `norm_title` → als Treffer werten. Tests mit Fixtures (§M1).

Scheduler (`server.js`): 15 s nach Start `runSync`, danach `setInterval` alle 12 h. Ein Modul-Flag verhindert parallele Läufe. `npm run sync` (`sync/run.js`) für den manuellen Lauf: öffnet DB, Migrationen, `runSync`, `process.exit(0)`.

---

## 6. API

Alle Routen unter `/api`, Auth per Cookie (`requireAuth`), außer `/api/healthz`, `/api/login`, `/api/register`, `/api/cal/:token.ics`.

| Methode | Pfad | Zweck | Antwort |
|---|---|---|---|
| GET | `/program?q=digger&date=2026-10-10&version=ov` | Vorstellungen. `q` (Teilstring auf `movies.title`/`norm_title`), `date` (Tag Berlin), `version` (`ov` = OV, OmU, OmeU; `df`), `from`/`to` optional. Default: ab jetzt, 14 Tage | `{ movies: [{id,title,year,runtime,poster_url, screenings:[{id,cinema_key,cinema_name,is_favorite,starts_at,version,auditorium,seats,attrs,ticket_url}]}] }` sortiert: Favoriten zuerst, dann Startzeit; innerhalb eines Films und Tages zweite Reihe nach `seats` absteigend |
| GET | `/program/days` | Tage mit Vorstellungen (für den Datumsstreifen) | `{ days: ['2026-10-06', …] }` |
| GET | `/cinemas` | alle Kinos mit Säle, Favoriten zuerst | `{ cinemas: [...] }` |
| GET | `/sources` | `source_health` | `{ sources: [{source,last_ok_at,last_count,last_error}] }` |
| GET | `/proposals` | offene + gebuchte (letzte 60 Tage) der Gruppe, mit Optionen, Votes je Nutzer, Mitglieder | `{ members:[{id,name}], proposals:[{id,status,movie,note,created_by,booked_option_id,options:[{id,snapshot,votes:{userId:value}}]}] }` |
| POST | `/proposals` | `{ movie_id, screening_ids: [2..5], note? }` → Snapshots anlegen, Ersteller stimmt automatisch `yes` für alle | 201 Proposal |
| PUT | `/proposals/:id/votes/:optionId` | `{ value: 'yes'|'maybe'|'no' }` upsert | 204 |
| POST | `/proposals/:id/book` | `{ option_id }` → status booked, booked_by, updated_at | 200 Proposal |
| POST | `/proposals/:id/cancel` | status cancelled | 204 |
| GET | `/proposals/:id.ics` | Einzel-Event der gebuchten Option | `text/calendar` |
| GET | `/cal/token` | Token des Nutzers (lazy anlegen, 32 Hex) + fertige URLs `https://…/api/cal/<t>.ics` und `webcal://…/api/cal/<t>.ics` | `{ token, https_url, webcal_url }` |
| GET | `/cal/:token.ics` | **ohne Cookie**. Alle gebuchten Vorstellungen der Gruppe des Token-Inhabers ab heute−30 Tage | `text/calendar` |
| GET | `/visits?year=2026` | Besuche der Gruppe (alle sehen alle), neueste zuerst | `{ visits:[…] }` |
| POST | `/visits` | `{ proposal_id? , screening_id?, movie_id?, watched_on, auditorium?, row?, seats?, companions: [userId…], note? }` → Snapshot aus Proposal-Option oder Screening | 201 |
| PATCH | `/visits/:id` | Felder ändern (nur Ersteller) | 200 |
| DELETE | `/visits/:id` | nur Ersteller | 204 |
| GET | `/visits/pending` | gebuchte Vorstellungen der Gruppe, Start < jetzt, ohne Besuch des Nutzers | `{ pending:[{proposal_id, snapshot}] }` |
| GET | `/stats/wrapped?year=2026&scope=me|group` | §9 | JSON |
| PATCH | `/me` | `{ letterboxd_user }` | 200 |

Validierung mit zod wie Einkauf; 422 bei Fehlern.

### ICS — `backend/src/ics.js`

```js
export function icsEvent({ uid, seq, start, end, summary, location, geo, description, url }) // alle Zeiten als Date
export function icsCalendar(events, { name = 'LiLief-Kino' } = {})
```

Regeln: Zeilenende `\r\n`; `TEXT`-Werte escapen (`\\`→`\\\\`, `;`→`\\;`, `,`→`\\,`, Zeilenumbruch→`\\n`); Zeilen länger als 75 Oktette falten (Umbruch + ein Leerzeichen); Zeiten in UTC als `YYYYMMDDTHHMMSSZ` (keine VTIMEZONE nötig); `DTSTAMP` = jetzt; `UID = proposal-<id>@kino.tunikb.com`; `SEQUENCE` = Unix-Sekunden von `proposals.updated_at` (steigt bei Änderung, iOS übernimmt dann Updates).

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LiLief//Kino//DE
CALSCALE:GREGORIAN
X-WR-CALNAME:LiLief-Kino
BEGIN:VEVENT
UID:proposal-12@kino.tunikb.com
DTSTAMP:20261006T100000Z
SEQUENCE:1791270000
DTSTART:20261013T181500Z
DTEND:20261013T204500Z
SUMMARY:🎬 Digger (OmU) · Delphi LUX
LOCATION:Delphi LUX\, Kantstraße 10\, 10623 Berlin
GEO:52.5056;13.3236
DESCRIPTION:Kino 2 · dabei: Kim\, Meri · Tickets: https://…\nVorschlag: https://kino.tunikb.com/vorschlaege/12
URL:https://kino.tunikb.com/vorschlaege/12
BEGIN:VALARM
TRIGGER:-PT60M
ACTION:DISPLAY
DESCRIPTION:Kino in einer Stunde
END:VALARM
END:VEVENT
END:VCALENDAR
```

`DTEND = start + (runtime ?? 120) + 20` Minuten. Header: `Content-Type: text/calendar; charset=utf-8`, bei Download zusätzlich `Content-Disposition: attachment; filename="kino-<id>.ics"`. Für den Feed **kein** `Content-Disposition`. `Cache-Control` darf für `/api/cal/*` `private, max-age=300` sein (Middleware in `app.js` prüft `res.get('Cache-Control')`, also vorher setzen).

---

## 7. Frontend

Kopieren aus `~/einkauf/frontend`: `vite.config.js` (Port 5176, Proxy-Ziel 3005, Manifest `name: 'LiLief-Kino'`, `short_name: 'Kino'`, Farben aus den neuen Tokens), `index.html` (Title/`apple-mobile-web-app-title` „Kino“), `src/main.jsx`, `src/api.js`, `src/index.css`, `components/{Header,BottomNav,Sheet,Logo}.jsx`, `screens/{Login,Register}.jsx`, `public/icons/*` (Icons später ersetzen, erst mal übernehmen).

Palette (nur Tokens in `index.css` ändern, Rest bleibt): hell `--bg #faf7f2`, `--primary #a8323f` (Kinovorhang-Rot), `--primary-dim #f5e1e3`, `--accent #d9a441` (Popcorn-Gold), `--grad-from #a8323f`, `--grad-to #e0705c`; dunkel `--bg #15110f`, `--surface #1f1917`, `--primary #e07a6b`, `--primary-dim #3a2320`, `--grad-from #c9574e`, `--grad-to #f0a08a`. Logo: Filmrolle oder Ticket mit demselben Verlauf, Herz als Signatur wie bei den anderen LiLief-Apps.

Routen (`App.jsx`, `Guard` wie Einkauf):

| Pfad | Screen | Tab |
|---|---|---|
| `/` | Programm | 🎬 Programm |
| `/vorschlaege`, `/vorschlaege/:id` | Vorschläge | 🗳 Vorschläge |
| `/besuche`, `/besuche/:id` | Besuche | 🎟 Besuche |
| `/wrapped` | Wrapped | ✨ Wrapped |
| `/einstellungen` | Einstellungen (über Avatar im Header) | – |

Polling wie Einkauf: `useQuery` mit `refetchInterval: 10_000` für Vorschläge, 60 s für Programm.

### Programm
- Suchfeld (`q`, debounce 300 ms) + horizontaler Datumsstreifen (`/program/days`, „Heute“, „Mi 7.“ …) + Chips „OV/OmU“, „Nur Favoriten“.
- Liste gruppiert nach Film (Poster klein wenn vorhanden, Titel, Jahr, Laufzeit). Darunter Zeilen: `20:15 · Delphi LUX · [OmU] · Kino 2 · 180 Pl. · Atmos`. Favoriten-Zeilen zuerst, dann eine zugeklappte Gruppe „Weitere Kinos (n)“.
- Tap auf Zeile → `ticket_url` in neuem Tab. Long-Press/Checkbox-Modus „Vorschlagen“: 2–5 Zeilen desselben Films wählen → Sheet mit Notiz → `POST /proposals` → Navigation zu `/vorschlaege/:id`.
- Leer-Zustand: „Nichts gefunden. Programm reicht etwa zwei Wochen voraus.“ Stale-Hinweis oben, wenn `/sources` eine Quelle mit `last_ok_at` älter als 36 h hat („Zoo Palast: Daten von gestern“).

### Vorschläge
- Karten: Film, Ersteller, Status-Badge. Pro Option eine Zeile: Datum/Zeit, Kino, Version, Saal, dann Avatare der Mitglieder mit ✓/?/✗ (eigener Vote als Tri-State-Button). Beste Option (meiste ✓, dann wenigste ✗) hervorgehoben.
- Buttons: „Gebucht“ (öffnet Bestätigung mit Option) → danach Buttons „.ics laden“ (`/api/proposals/:id.ics`) und „Kalender abonnieren“ (zeigt `webcal_url` als Link + Kopieren). Hinweis unter dem Abo-Link: iOS öffnet beim Tippen den Abo-Dialog; einmal abonnieren reicht für alle künftigen Buchungen.
- Abgelaufene gebuchte Vorschläge zeigen „Besuch eintragen“ (→ Besuche mit vorbefülltem Formular).

### Besuche
- Oben „Offen“: `/visits/pending`. Darunter Liste nach Datum.
- Formular (Sheet): Film (aus Vorschlag/Vorstellung vorbefüllt, sonst Freitext + Jahr), Kino (Select aus `/cinemas`), Datum, Saal (Select aus `auditoriums` des Kinos, plus Freitext), Reihe, Sitze, Begleitung (Chips der Mitglieder), Notiz. Feld „kinoheld-Bestelltext einfügen“: RegExp `/Saal\s*([^\n,]+)/`, `/Reihe\s*(\w+)/g`, `/Sitz\s*(\d+)/g` füllt Saal/Reihe/Sitze.
- Button **„In Letterboxd bewerten“**: `letterboxd://x-callback-url/log?name=<encodeURIComponent(`${title} ${year ?? ''}`.trim())>&date=<watched_on>&x-success=<encodeURIComponent(`${location.origin}/besuche/${id}`)>`. Darunter kleiner Link „Auf letterboxd.com öffnen“: `https://letterboxd.com/tmdb/<tmdb_id>/` wenn vorhanden, sonst `https://letterboxd.com/search/<encodeURIComponent(title)>/`. Zeigt `letterboxd_rating` als Sterne, sobald synchronisiert.

### Wrapped
- Jahr-Umschalter, Scope „Ich“/„Gruppe“. Kacheln (`.tiles`/`.tile` aus Einkauf-CSS): Besuche, Stunden im Kino, OV-Anteil, Lieblingskino, Lieblingssaal, häufigste Reihe, treueste Begleitung, erster und letzter Film, Top-Monat. Button „Als Bild teilen“: Canvas 1080×1920 mit den Kacheln rendern, `canvas.toBlob` → `navigator.share({ files })`, Fallback Download.

### Einstellungen
- Letterboxd-Nutzername (PATCH `/me`), Kalender-Abo-Link, Datenquellen-Status (Tabelle aus `/sources`, rot wenn > 36 h), Abmelden.

---

## 8. Letterboxd-Abgleich — `backend/src/letterboxd.js`

Täglich im Sync (Schritt 7). Für jeden Nutzer mit `letterboxd_user`: `GET https://letterboxd.com/<user>/rss/` (öffentlich, letzte ~50 Einträge). Parsen per RegExp über `<item>…</item>`:

```
<letterboxd:watchedDate>2026-10-06</letterboxd:watchedDate>
<letterboxd:memberRating>4.0</letterboxd:memberRating>
<letterboxd:filmTitle>Digger</letterboxd:filmTitle>
<letterboxd:filmYear>2026</letterboxd:filmYear>
<tmdb:movieId>123456</tmdb:movieId>
```

Zuordnung zu `visits` des Nutzers ohne `letterboxd_synced_at`: `movies.tmdb_id == tmdb:movieId` **oder** `normTitle(filmTitle) == movies.norm_title`, und `|watched_on − watchedDate| ≤ 1 Tag` → `letterboxd_rating`, `letterboxd_synced_at` setzen. Items ohne `watchedDate` ignorieren. Fehler nur loggen.

---

## 9. Wrapped-Berechnung — `routes/stats.js`

Eine SQL-Abfrage auf `visits` (+ `movies`) für `watched_on` im Jahr, `scope=me` → `user_id = me`, `scope=group` → `household_id`:

- `count`, `minutes = SUM(COALESCE(movies.runtime, json_extract(snapshot_json,'$.runtime'), 120))`
- `ov_share = AVG(json_extract(snapshot_json,'$.version') IN ('OV','OmU','OmeU'))`
- `top_cinema`, `top_auditorium` (cinema+auditorium), `top_row` (`row`), `top_companion` (json_each über `companions_json`), `top_month` (`strftime('%m')`): je `GROUP BY … ORDER BY COUNT(*) DESC LIMIT 1`
- `first`, `last`: MIN/MAX `watched_on` mit Titel.

---

## 10. Meilensteine mit Prüfung

### M1 – Scaffold, Sync, Programm (ein Abend)

1. `[Local]` Repo anlegen: Dateien gemäß §2 kopieren, `package.json`-Namen setzen, `npm install`.
2. `[Local]` `~/.claude/launch.json` um zwei Einträge ergänzen (Muster `einkauf-backend`/`einkauf-frontend`): `kino-backend` (cwd `~/kino/backend`, env `DATABASE_PATH=./data/dev.db`, `REGISTER_INVITE_CODE=CREW-DEV`, `PORT=3005`), `kino-frontend` (cwd `~/kino/frontend`, port 5176, `VITE_API_TARGET=http://localhost:3005`).
3. Migration, `cinemas.json`, Auth-Kopie, Tests `auth.test.js` (aus Einkauf übernehmen, Erwartungen `household: { id: 1, name: 'Kino-Crew' }`).
4. `shared/normalize.js` + Tests.
5. Fixtures aufnehmen und **kürzen** (je Datei < 200 kB, nur ein paar Filme/Vorstellungen behalten) nach `backend/test/fixtures/`:
   ```bash
   # [Local]
   cd ~/kino/backend/test/fixtures && UA='LiLief-Kino/1.0 (private use)'
   curl -s -A "$UA" -H 'content-type: application/json' -H 'origin: https://www.kinoheld.de' --data '{"query":"{ programShows(cinemaProximity:{city:\"Berlin\", distance:25}, dates:[\"'$(date +%F)'\"], first:20) { paginatorInfo { hasMorePages } data { id beginning urlSlug isBookable auditorium { name seatCount } audioLanguage { name } subtitleLanguage { name } flags { category name } cinema { id name } movie { id title titleOriginal productionYear duration } } } }"}' https://next-live.kinoheld.de/graphql > kinoheld-shows.json
   curl -s -A "$UA" https://www.yorck.de/filme > yorck.html
   curl -s -A "$UA" -H 'origin: https://zoopalast.premiumkino.de' -H 'referer: https://zoopalast.premiumkino.de/' https://backend.premiumkino.de/v1/de/zoopalast/program > zoopalast-program.json
   curl -s -A "$UA" -H 'origin: https://zoopalast.premiumkino.de' -H 'referer: https://zoopalast.premiumkino.de/' https://backend.premiumkino.de/v1/de/zoopalast/config > zoopalast-config.json
   curl -s -A "$UA" https://www.uci-kinowelt.de/kinoprogramm/berlin-mercedes-platz/82 > uci.html
   curl -s -A "$UA" https://www.berlin.de/kino/_bin/kinodetail.php/34187/ > berlinde-alhambra.html
   ```
   Yorck/UCI-HTML auf den relevanten Teil kürzen (`__NEXT_DATA__`-Block mit 2 Filmen; UCI: 2 Filmblöcke).
6. Adapter + Tests: jeder Adapter bekommt einen Test „parst Fixture zu Rows mit korrekter version/auditorium/startsAt“ (Fetch per injiziertem `ctx.fetch`, der die Fixture liefert). Merge-Test: kinoheld-Zeile Zoo Palast ohne version + zoopalast-Zeile gleiche Zeit → eine Vorstellung mit version und Saal.
7. `routes/program.js` + Test (Favoriten zuerst, `q`-Filter, `version=ov`).
8. Frontend: Login/Register, Programm-Screen, BottomNav mit 4 Tabs (andere Tabs vorerst Platzhalter „kommt in M2/M3“).
9. Prüfung:
   ```bash
   # [Local]
   cd ~/kino && npm test
   cd ~/kino/backend && DATABASE_PATH=./data/dev.db npm run sync   # erwartet: Log je Quelle "ok <n>" für 5 Quellen, n>0
   sqlite3 ./data/dev.db "SELECT source, last_count, last_error FROM source_health; SELECT COUNT(*) FROM screenings; SELECT cinema_key, version, COUNT(*) FROM screenings WHERE cinema_key IN ('delphi-lux','zoo-palast','cineplex-alhambra','uci-mercedes-platz','city-kino-wedding') GROUP BY 1,2;"
   ```
   Erwartet: 5 Quellen ohne Fehler, > 3000 Vorstellungen, für jeden Favoriten Zeilen mit `version` ≠ NULL. Browser `http://localhost:5176`: registrieren mit `CREW-DEV`, Suche „Digger“ zeigt Favoriten zuerst mit Versions-Badges.
10. Commit `M1: Programm-Sync und Programm-Screen`.

### M2 – Vorschläge, Abstimmung, Gebucht, Kalender (ein Abend)

1. Routen `proposals.js`, `calendar.js`, `ics.js` + Tests: Snapshot wird beim Anlegen eingefroren (Screening danach ändern → Option unverändert); Vote-Upsert; `book` setzt Status; `.ics`-Ausgabe enthält `SUMMARY`, `LOCATION` mit Adresse, UTC-Zeiten, gefaltete Zeilen; Feed ohne Cookie mit gültigem Token 200, falschem Token 404.
2. Frontend Vorschläge-Screen, Auswahlmodus im Programm, Einstellungen (Abo-Link).
3. Prüfung: zwei Nutzer im Dev (zwei Browser-Profile), Vorschlag mit 3 Optionen, beide stimmen ab, „Gebucht“, `.ics` herunterladen und mit `python3 -c "import sys;print(open(sys.argv[1],'rb').read().count(b'\r\n'))" ~/Downloads/kino-1.ics` prüfen (> 10 Zeilen, CRLF). Feed-URL in macOS Kalender „Neues Kalenderabonnement“ einfügen (localhost geht dort) → Event mit Adresse und Alarm sichtbar.
4. Commit `M2: Vorschläge, Abstimmung, Kalender`.

### M3 – Besuche, Letterboxd (halber Abend)

1. `visits.js`, `letterboxd.js`, `tmdb.js` (No-Op ohne `TMDB_API_KEY`) + Tests: RSS-Fixture (eine echte Datei `https://letterboxd.com/<öffentlicher Nutzer>/rss/` kürzen) → Rating landet am passenden Besuch; Pending-Liste.
2. Frontend Besuche-Screen inkl. Letterboxd-Buttons und Bestelltext-Parser.
3. Prüfung: Besuch anlegen, Button öffnet (auf dem iPhone) die Letterboxd-App mit Suche „Digger 2026“ und Datum; im Simulator/Desktop reicht: Link-Href stimmt (Test im Frontend nicht nötig, Sichtprüfung).
4. Commit `M3: Besuche und Letterboxd`.

### M4 – Wrapped (halber Abend)

1. `stats.js` + Test mit 5 Besuchen (zwei Kinos, zwei Reihen, OV-Anteil 0.6).
2. Frontend Wrapped + Teilen-Bild.
3. Commit `M4: Wrapped`.

### M5 – Deploy (eine Stunde, mit Nutzer)

Alle Schritte stehen ausformuliert in `docs/DEPLOY.md` (M5 schreibt diese Datei nach dem Muster von `~/einkauf/docs/DEPLOY.md`, mit den Werten unten). Kurzfassung:

**Dateien im Repo (`deploy/`):**

`compose.yml` — kopieren aus Einkauf, dann: `name: kino`, Service `kino-api` (nicht `api`!), `volumes: - /opt/kino/data:/data`, Service `einkauf-fetch` komplett entfernen, `networks: deploy_default: external: true` behalten, `user: "1000:1000"`, `read_only: true`, `tmpfs: /tmp`, `security_opt: no-new-privileges:true` behalten.

`Dockerfile` (backend/) — kopieren, `EXPOSE 3005`. `data/cinemas.json` wird mitkopiert (liegt unter `backend/`).

`.env.example`:
```
NODE_ENV=production
PORT=3005
DATABASE_PATH=/data/app.db
# Ohne Code ist die Registrierung geschlossen (fail closed). Nur an die Gruppe geben.
REGISTER_INVITE_CODE=
# Optional: Poster/Laufzeit/TMDB-ID. Leer = aus, App läuft trotzdem.
TMDB_API_KEY=
# Öffentliche Basis-URL für Kalender- und Letterboxd-Links
PUBLIC_URL=https://kino.tunikb.com
```

`deploy.sh` — kopieren, überall `einkauf` → `kino`, `einkauf-api` → `kino-api`.

`backup.sh` — kopieren, `einkauf` → `kino`. Crontab-Zeile: `25 3 * * * /opt/kino/deploy/backup.sh >> /opt/kino/backup.log 2>&1` (andere Minute als Einkauf 3:15 und Workout).

**Einzige Änderungen außerhalb des Repos** (beide in `~/workout-app/deploy/`):

Caddyfile, Block anhängen:
```
kino.tunikb.com {
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy strict-origin-when-cross-origin
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    -Server
  }
  handle /api/* {
    reverse_proxy kino-api:3005
  }
  handle {
    root * /srv/kino
    try_files {path} /index.html
    file_server
  }
}
```
compose.yml, unter `caddy.volumes` eine Zeile: `- /opt/kino/deploy/frontend-dist:/srv/kino`.

Reihenfolge:

1. `[Local]` `cd ~/kino && git init -b main && git add . && git commit -m "M1-M4: LiLief-Kino" && gh repo create hal-9/kino --private --source . --push`
2. `[Local]` Deploy-Key: `ssh vps 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/kino_deploy -C vps-kino >/dev/null && cat ~/.ssh/kino_deploy.pub' > /tmp/kino_deploy.pub && gh repo deploy-key add /tmp/kino_deploy.pub -R hal-9/kino --title vps`
3. `[VPS]` `printf '\nHost github.com-kino\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/kino_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config`
4. `[VPS]` `sudo mkdir -p /opt/kino && sudo chown $USER:$USER /opt/kino && git clone git@github.com-kino:hal-9/kino.git /opt/kino`
5. `[VPS]` `cp /opt/kino/deploy/.env.example /opt/kino/deploy/.env && nano /opt/kino/deploy/.env` → **[Nutzer]** `REGISTER_INVITE_CODE` setzen (`openssl rand -hex 6`), optional `TMDB_API_KEY`.
6. **[Nutzer, Cloudflare]** A-Record `kino` → VPS-IP, **DNS only**. Prüfen `[Local]` `dig +short kino.tunikb.com`.
7. `[Local]` `cd ~/workout-app && git add deploy/Caddyfile deploy/compose.yml && git commit -m "Caddy: kino.tunikb.com" && git push` — **nur diese zwei Dateien.** Vorher `git status` prüfen, dass nichts anderes mitgeht.
8. `[VPS]` `/opt/kino/deploy/deploy.sh` → dann `docker compose -f /opt/kino/deploy/compose.yml ps` (kino-api „Up“), `docker compose -f /opt/kino/deploy/compose.yml logs --tail 30 kino-api` (Sync-Log „ok“ je Quelle).
9. `[VPS]` Caddy neu erstellen (Pflicht, `restart` reicht nicht, Inode-Problem): `cd /opt/workout/app && git pull && cd deploy && docker compose up -d --force-recreate caddy && docker compose exec -T caddy grep -c kino /etc/caddy/Caddyfile` → Zahl ≥ 1. **Nichts anderes in diesem Verzeichnis ausführen.** Danach `docker compose ps` dort: `deploy-api-1` und `deploy-caddy-1` beide „Up“, Workout-Login im Browser kurz prüfen.
10. `[Local]` `curl -s -o /dev/null -w '%{http_code}\n' https://kino.tunikb.com/api/healthz` → 200. `curl -s 'https://kino.tunikb.com/api/program?q=a' -o /dev/null -w '%{http_code}\n'` → 401 (Auth greift).
11. **[Nutzer]** Im Safari registrieren (Invite-Code), „Zum Home-Bildschirm“, Einstellungen → Kalender abonnieren (Tipp auf den webcal-Link), Letterboxd-Nutzername eintragen. Invite-Code an Kim, Meri, Daniel, Micha.
12. `[VPS]` Crontab-Zeile für `backup.sh` eintragen (`crontab -e`), Testlauf `/opt/kino/deploy/backup.sh && ls /opt/kino/backups`.

Updates später: `[VPS]` `/opt/kino/deploy/deploy.sh`.

---

## 11. Abnahme (Ende des Plans)

- [ ] `https://kino.tunikb.com` lädt als PWA, Login/Registrierung funktioniert, Workout/Einkauf/Dienstplan/Diary/Paperless laufen unverändert (`docker ps` zeigt alle Container „Up“, Logins prüfen).
- [ ] Suche „Digger“ zeigt Vorstellungen der 5 Favoriten mit OV/OmU-Badges und Saal (Zoo Palast, UCI, City Kino), darunter „Weitere Kinos“.
- [ ] `source_health` ohne Fehler für alle 5 Quellen; Einstellungen zeigen das.
- [ ] Vorschlag anlegen, zweiter Nutzer stimmt ab, „Gebucht“, Event erscheint im abonnierten iOS-Kalender mit Adresse und 60-Minuten-Alarm.
- [ ] Besuch eintragen, Letterboxd-Button öffnet die App mit vorbefülltem Film; nach dem Loggen in Letterboxd steht spätestens am nächsten Tag das Rating am Besuch.
- [ ] Wrapped zeigt Zahlen aus den Besuchen; „Als Bild teilen“ liefert ein PNG.
- [ ] Nächtliches Backup liegt in `/opt/kino/backups/`.

---

## 12. Bekannte Fallstricke

- **Compose-Projektname und Service-Name müssen eindeutig sein** (`name: kino`, `kino-api`). Ohne `name:` ersetzt Compose fremde Container im geteilten Netz (Vorfall 2026-08-27).
- **Caddyfile ist ein Einzeldatei-Bind-Mount**: nach `git pull` immer `up -d --force-recreate caddy`, nie `restart`, dann per `grep -c` im Container prüfen.
- **Workout-Repo auf dem VPS ist weiter als die laufenden Container.** `git pull` dort ist nötig für die Caddyfile, aber danach niemals `deploy.sh` oder `up -d --build api` im Workout-Stack ausführen.
- **`/opt/kino` muss dem User gehören** (`chown`), Container läuft als `1000:1000`, sonst kann SQLite nicht schreiben.
- **Yorck-Offset ist falsch** (`+01:00` im Sommer): Lokalzeit neu interpretieren, sonst sind alle Yorck-Zeiten eine Stunde daneben.
- **kinoheld-Platzhalter-Säle** („Saal 1“ ohne `seatCount`) bei Ketten als `null` behandeln, sonst überschreibt die Basis echte Säle der Overlays.
- **berlin.de ist die einzige Alhambra-Quelle**: wenn dort die Struktur wechselt, fehlt Alhambra nur die Version; kinoheld liefert weiter die Zeiten.
- **GraphQL-Limit**: `first` maximal 100, sonst Fehler „Maximum number of 100 requested items exceeded“.
- **Letterboxd-Deep-Link** funktioniert nur auf dem Gerät mit installierter App; `name` ist eine Suche, der Nutzer bestätigt den Film in der App.
- Rate-Limiter in `app.js` zählt pro IP hinter Caddy (`trust proxy 1`); 5 Handys mit 10-s-Polling bleiben weit unter 3000/15 min.
