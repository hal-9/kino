# LiLief-Kino – Kinoprogramm, Abstimmung, Besuchslog

Stand: 2026-10-06 (Planungsrunde). Ziel: „Welches Kino zeigt Film X in OV, wann,
mit dem größten Saal?“ für Berlin, dazu gemeinsames Finden eines Termins
(Vorschlag → Abstimmung → Gebucht → Kalender), ein Besuchslog (Saal, Reihe,
Sitz) mit Sprung in die Letterboxd-App, und ein „Wrapped“ zum Jahresende.
Kompakt, keine Feature-Sammlung.

## Entscheidungen (abgestimmt 2026-10-06)

| Thema | Entscheidung | Grund |
|---|---|---|
| Favoriten | Delphi LUX, Zoo Palast, Cineplex Alhambra, UCI Luxe Mercedes Platz, City Kino Wedding | Nutzerangabe. Alle anderen Berliner Kinos = „zweite Reihe“, nur gezeigt wenn Favoriten nichts Passendes haben |
| Gruppe | Tuncay, Kim, Meri, Daniel, Micha | eine Gruppe, Beitritt per Invite-Code wie Einkauf |
| Datenbasis | kinoheld GraphQL (öffentlich, ohne Key) als Basis für alle ~75 Berliner Kinos | einzige Quelle mit allen Kinos, Saal + Sitzplatzzahl bei Partnerkinos |
| Ketten-Overlays | eigene Adapter pro Kette für OV-Flag und Saal (Yorck, Zoo Palast, UCI, berlin.de für Cineplex) | kinoheld hat bei Ketten weder Sprache noch echten Saal. Scraping vom User freigegeben |
| Scraping-Stil | 2× täglich, Node `fetch`, kein Headless-Browser, UA nennt die App | weit unter jedem Limit; Eigenbedarf |
| Ausfallverhalten | pro Quelle „last good“ behalten, Quelle als „stale“ markieren, App zeigt nie leeres Programm | Schema-Drift ist das echte Risiko, nicht Sperren |
| Saal-Referenz | `cinemas.json` im Repo: Adresse, Säle, Sitze, Leinwandbreite, Lieblingsreihe für die Favoriten (kinokompendium.de, Kettenseiten) | dafür gibt es keine API |
| Sitzplätze | manuelle Eingabe Reihe/Sitz; kinoheld-Bestelltext einfügbar („Reihe 9, Sitz 11“) | keine öffentlichen Sitzpläne |
| Letterboxd | `letterboxd://x-callback-url/log?name=<Titel Jahr>&date=…&rating=…`; Rücklesen über öffentlichen RSS-Feed | offizielle API lehnt private Projekte ab |
| Kalender | `.ics` pro gebuchter Vorstellung **und** Abo-Feed `webcal://…/cal/<token>.ics` pro Nutzer | Abo braucht keinen Export-Schritt; gleicher Code |
| Push | keins in v1, Polling + Badge | iOS Web-Push ist Aufwand ohne Nutzen bei 5 Leuten |
| Stack | wie Einkauf: npm workspaces, React + Vite PWA, Express + better-sqlite3, deutsches UI, Docker hinter dem geteilten Caddy | gleiches Deploy-Muster |

Offen (Default in Klammern, bis anders entschieden):
- Name/Domain (**LiLief-Kino**, `kino.tunikb.com`, API-Port **3005**).
- Sortierung der zweiten Reihe (**Sitzplatzzahl des Saals absteigend**, optional Distanz zu `HOME_LAT/HOME_LNG` aus `.env`).
- Delphi LUX hat über Yorck keinen Saal pro Vorstellung → Saal beim Besuch von Hand wählen (Liste aus `cinemas.json`).

## Datenquellen (alle am 2026-10-06 live verifiziert)

| Quelle | Deckt | Format | OV | Saal | Horizont |
|---|---|---|---|---|---|
| kinoheld GraphQL `POST https://next-live.kinoheld.de/graphql` | alle Berliner Kinos, inkl. City Kino Wedding (Partner: Saal + Sitze + Sprachflags) | JSON, max 100/Seite | nur Partnerkinos | nur Partnerkinos | ~2 Wochen |
| Yorck `https://www.yorck.de/filme` → `__NEXT_DATA__` | Delphi LUX + 13 weitere Yorck-Häuser | JSON im HTML | `formats: OmU/OmeU/OV/DF` | nein | ~4 Wochen |
| Zoo Palast `https://backend.premiumkino.de/v1/de/zoopalast/program` | Zoo Palast | JSON | `language: "Sprache: Englisch"` | `auditoriumId` + `auditoriumUsed` | ~5 Wochen |
| UCI `https://www.uci-kinowelt.de/kinoprogramm/<slug>/<id>` | UCI Luxe Mercedes Platz (82), Eastgate, Gropius | HTML, serverseitig | `data-version="ov|…"` | `data-tracking-auditorium` | ~2 Wochen |
| berlin.de `kinodetail.php/34187/` | Cineplex Alhambra (cineplex.de blockt Nicht-Browser) | HTML | „(OmU)“/„(OV)“ im Titel und je Zeit | nein | ~1 Woche |
| CinemaxX `/api/microservice/showings/cinemas/1107/films?…` | Potsdamer Platz | JSON | Attribut `Language` | `screenName`, Tag „Größte Leinwand“ | zweite Reihe, später |
| CineStar `/api/cinema/<id>/show/?appVersion=1.5.3` | Cubix, Tegel, Hellersdorf, KulturBrauerei | JSON | `AUDIO_OV/OmU/OmeU` | Screen-ID (Namen von Hand) | zweite Reihe, später |
| TMDB | Poster, Laufzeit, Originalsprache, ID für Letterboxd-Fallback | JSON, Key in `.env` | – | – | – |

Merge-Schlüssel Basis ↔ Overlay: Kino-Alias + Startzeit (Minute) + normalisierter
Titel (ohne „(OV)“, Jahr, Umlaute). Overlay gewinnt bei Version und Saal.
Overlay-Vorstellungen ohne kinoheld-Treffer werden zusätzlich eingefügt.

## Architektur

```
┌──────────────────────┐  06:00 + 18:00 (im API-Prozess)  ┌───────────────────────┐
│ sync/                │ ───────────────────────────────▶ │ /opt/kino/data/app.db │
│  kinoheld.js (Basis) │   je Quelle: fetch → normalize   │  screenings, movies,  │
│  yorck.js  zoo.js    │   → merge → upsert, last_seen    │  source_health        │
│  uci.js  berlinde.js │   Fehler → Quelle stale, Rest ok └───────────┬───────────┘
└──────────────────────┘                                              │
┌────────────────────┐   /api/*     ┌─────────────────────────────────▼──────────┐
│ React/Vite PWA     │ ◀──────────▶ │ kino-api (Express, Port 3005)              │
│ kino.tunikb.com    │              │  Auth wie Einkauf (Invite, 90-Tage-Cookie) │
└────────────────────┘              │  /cal/<token>.ics für Kalender-Abos        │
        ▲ Caddy-Block im            └────────────────────────────────────────────┘
        │ workout-app Caddyfile
```

- Compose `name: kino`, Service `kino-api`, joint `deploy_default`, `user: 1000:1000`.
- Sync läuft im API-Prozess (Start + alle 12 h) und als `npm run sync` von Hand.
- Jede Quelle ist eine Datei mit derselben Rückgabe:
  `{ cinemaKey, startsAt, title, version: 'OV'|'OmU'|'OmeU'|'DF'|null, auditorium, attrs[], ticketUrl }`.

## Datenmodell (app.db)

```
users, auth_sessions, groups, group_members     -- wie Einkauf (households → groups)
cinemas        key, name, chain, street, zip, lat, lng, is_favorite, kinoheld_id, sources_json
auditoriums    cinema_key, name, seats, screen_width_m, favorite_row   -- Seed aus cinemas.json + kinoheld
movies         id, title, title_original, year, runtime, tmdb_id, poster_url
screenings     id, cinema_key, movie_id, auditorium, starts_at, version, attrs_json,
               ticket_url, source, first_seen_at, last_seen_at        -- nie hart löschen, „verschwunden“ = last_seen alt
source_health  source, last_ok_at, last_error, last_count
proposals      id, group_id, movie_id, created_by, status ('open'|'booked'|'cancelled'), booked_option_id, note
proposal_options id, proposal_id, screening_snapshot_json              -- Snapshot, damit Programmänderungen nichts kaputt machen
votes          option_id, user_id, value ('yes'|'maybe'|'no')
visits         id, user_id, proposal_id?, screening_snapshot_json, watched_on, auditorium,
               row, seats, companions_json, letterboxd_rating, letterboxd_synced_at
cal_tokens     user_id, token
```

## Screens

1. **Programm** – Suchfeld (Film) oder Datum. Treffer: Favoriten zuerst, dann
   „Weitere Kinos“. Pro Zeile: Kino, Zeit, Version-Badge (OV/OmU/OmeU), Saal +
   Sitze, Technik-Tags (IMAX, Atmos, Größte Leinwand). Sortierung: größter Saal
   zuerst. Tap → Ticketlink. Mehrfachauswahl → „Vorschlagen“.
2. **Vorschläge** – Liste offener Vorschläge mit Doodle-Zeile pro Option
   (✓ / ? / ✗ je Person), beste Option hervorgehoben. „Gebucht“ friert den
   Snapshot ein, zeigt `.ics`-Button und den Abo-Link. Gebuchte Vorschläge
   erscheinen nach der Vorstellung als „Besuch eintragen?“.
3. **Besuche** – Eintrag aus gebuchtem Vorschlag oder frei: Film, Kino, Saal,
   Reihe, Sitze, wer dabei war. Button „In Letterboxd bewerten“ (x-callback mit
   Titel, Jahr, Datum; Rücksprung per `x-success`). Rating kommt später per RSS.
4. **Wrapped** – Jahreskarte: Besuche, Lieblingskino, Lieblingssaal, häufigste
   Reihe, OV-Anteil, Gesamtlaufzeit, erster/letzter Film. Teilen als Bild.
5. Login/Registrieren (Invite-Code), Einstellungen (Datenquellen-Status, Kalender-Abo-Link, Letterboxd-Nutzername).

## Kalender-Event (ics)

```
SUMMARY: 🎬 Digger (OmU) · Delphi LUX
DTSTART/DTEND: Start (UTC) / Start + Laufzeit + 20 min
LOCATION: Delphi LUX, Kantstraße 10, 10623 Berlin   + GEO aus kinoheld
DESCRIPTION: Saal 2 · dabei: Kim, Meri · Tickets: <link> · Vorschlag: <app-link>
VALARM: 60 min vorher
```

## Meilensteine

| M | Inhalt | Prüfung |
|---|---|---|
| M1 | Scaffold (workspaces, Auth kopiert), `cinemas.json` für 5 Favoriten, Sync kinoheld + Yorck + Zoo Palast + UCI + berlin.de, Programm-Screen | `npm run sync` füllt screenings; Suche „Digger“ zeigt Favoriten mit OV-Badge; Tests für Normalisierung + Merge |
| M2 | Vorschläge, Abstimmung, Gebucht, `.ics` + webcal-Feed | Zwei Nutzer stimmen ab, Abo-Feed in iOS-Kalender zeigt Event mit Adresse |
| M3 | Besuche + Letterboxd-Deep-Link + RSS-Abgleich | Button öffnet Letterboxd-App mit vorbefülltem Film; Rating landet am Besuch |
| M4 | Wrapped | Seite rendert aus Testdaten, Teilen als Bild |
| M5 | Deploy `kino.tunikb.com` (Caddy-Block, Compose `name: kino`, Backup wie Einkauf) | Gruppe registriert, Programm-Sync läuft auf dem VPS |
| später | CinemaxX- und CineStar-Adapter für die zweite Reihe, Distanz-Sortierung, Push | – |

Aufwand: M1 ein Abend, M2 ein Abend, M3+M4 ein Abend, M5 eine Stunde.
