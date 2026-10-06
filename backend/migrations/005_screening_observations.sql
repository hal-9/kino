-- K03: Eine physische Vorstellung kann mehrere Säle/Fassungen zur selben Zeit haben. Die alte
-- UNIQUE (cinema_key, movie_id, starts_at) hat solche Vorstellungen zusammengelegt; sie wird durch
-- einen Neuaufbau der Tabelle (IDs bleiben, proposal_options.screening_id zeigt weiter richtig) ersetzt.
-- Läuft mit FK-Prüfung aus und foreign_key_check vor dem Commit (migrate.js).
-- Identität entsteht jetzt über Quellen-Beobachtungen (source, source_key) und den Resolver in sync/index.js.
CREATE TABLE screenings_new (
  id INTEGER PRIMARY KEY, cinema_key TEXT NOT NULL REFERENCES cinemas(key), movie_id INTEGER NOT NULL REFERENCES movies(id),
  starts_at TEXT NOT NULL,
  version TEXT CHECK (version IN ('OV','OmU','OmeU','DF') OR version IS NULL),
  auditorium TEXT, attrs_json TEXT NOT NULL DEFAULT '[]', ticket_url TEXT,
  source TEXT NOT NULL, source_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO screenings_new (id, cinema_key, movie_id, starts_at, version, auditorium, attrs_json, ticket_url, source, source_id, first_seen_at, last_seen_at)
  SELECT id, cinema_key, movie_id, starts_at, version, auditorium, attrs_json, ticket_url, source, source_id, first_seen_at, last_seen_at FROM screenings;
DROP TABLE screenings;
ALTER TABLE screenings_new RENAME TO screenings;
CREATE INDEX screenings_time ON screenings (starts_at);
CREATE INDEX screenings_movie ON screenings (movie_id, starts_at);
CREATE INDEX screenings_cinema ON screenings (cinema_key, starts_at);

-- Was eine Quelle über eine Vorstellung gesagt hat. source_key = Provider-ID, sonst dokumentierter
-- Fallback (Kino|Titel|UTC-Zeitpunkt|Saal|Fassung); nie Ticket-Token oder Auslastung.
CREATE TABLE screening_observations (
  id INTEGER PRIMARY KEY,
  screening_id INTEGER NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  source TEXT NOT NULL, source_key TEXT NOT NULL,
  cinema_key TEXT NOT NULL, title TEXT NOT NULL, year INTEGER, starts_at TEXT NOT NULL,
  version TEXT, auditorium TEXT, attrs_json TEXT NOT NULL DEFAULT '[]', ticket_url TEXT, runtime INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_key)
);
CREATE INDEX screening_observations_screening ON screening_observations (screening_id);

-- Backfill nur mit stabiler Provider-ID; Zeilen ohne ID bekommen ihre Beobachtung beim nächsten Sync
-- über den Kandidatenabgleich. Zusammengelegte Altdaten werden nicht nachträglich geraten.
INSERT OR IGNORE INTO screening_observations
  (screening_id, source, source_key, cinema_key, title, year, starts_at, version, auditorium, attrs_json, ticket_url, runtime, first_seen_at, last_seen_at)
  SELECT s.id, s.source, s.source_id, s.cinema_key, m.title, m.year, s.starts_at, s.version, s.auditorium, s.attrs_json, s.ticket_url, m.runtime, s.first_seen_at, s.last_seen_at
  FROM screenings s JOIN movies m ON m.id = s.movie_id WHERE s.source_id IS NOT NULL;
