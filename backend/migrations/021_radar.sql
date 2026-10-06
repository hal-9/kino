-- K29: Kino-Radar, nur in der App. Einwilligung je Person (enabled, Standard aus), Ruhezeit (Berliner HH:mm), Tageslimit.
-- Abmelden = enabled 0 + unsubscribed_at; wird bei jeder Zustellung erneut geprüft.
CREATE TABLE radar_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  enabled INTEGER NOT NULL DEFAULT 0, consented_at TEXT, unsubscribed_at TEXT,
  quiet_start TEXT, quiet_end TEXT,
  daily_cap INTEGER NOT NULL DEFAULT 5 CHECK (daily_cap BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Stummschalten je gemerktem Film.
ALTER TABLE watchlist ADD COLUMN radar_muted INTEGER NOT NULL DEFAULT 0;
-- Logisches Ereignis je Empfänger; dedupe_key macht wiederholte/umsortierte Importe zu einem Ereignis.
CREATE TABLE radar_events (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('watch_available', 'booked_change')),
  dedupe_key TEXT NOT NULL, movie_id INTEGER REFERENCES movies(id), proposal_id INTEGER REFERENCES proposals(id),
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), read_at TEXT,
  UNIQUE (user_id, dedupe_key)
);
-- Transaktionaler Ausgang: Erkennung und Zustellung getrennt, begrenzte Wiederholungen, sichtbarer Zustand.
-- Kanal nur 'inapp'; ein externer Kanal braucht eine eigene Migration und Freigabe.
CREATE TABLE radar_outbox (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES radar_events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'inapp' CHECK (channel IN ('inapp')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'suppressed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, delivered_at TEXT,
  UNIQUE (event_id, channel)
);
CREATE INDEX radar_outbox_due ON radar_outbox (state, next_attempt_at);
