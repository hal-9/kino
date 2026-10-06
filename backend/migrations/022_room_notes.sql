-- K30: persönliche Saal-Notizen, getrennt von Anbieter-Fakten (auditoriums). Identität = Kino + normierter Saalname
-- (room_key); gleicher Name in zwei Kinos ist nie derselbe Saal. Roher Name (room_label) bleibt erhalten.
-- shared = 0: nur Besitzer; 1: Haushalt darf lesen. Bearbeiten/Löschen nur Besitzer.
CREATE TABLE room_notes (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), household_id INTEGER NOT NULL REFERENCES households(id),
  cinema_key TEXT NOT NULL REFERENCES cinemas(key), room_key TEXT NOT NULL, room_label TEXT NOT NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  noted_on TEXT NOT NULL, row TEXT, seat TEXT,
  comfort INTEGER CHECK (comfort BETWEEN 1 AND 5), sightline INTEGER CHECK (sightline BETWEEN 1 AND 5), sound INTEGER CHECK (sound BETWEEN 1 AND 5),
  note TEXT, shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX room_notes_room ON room_notes (cinema_key, room_key);
