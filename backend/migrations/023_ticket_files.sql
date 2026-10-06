-- K32: private Ticket-Dateien zu einer Buchung. Datei liegt außerhalb jedes statischen Verzeichnisses unter einem
-- zufälligen Schlüssel (storage_key, nie ein Nutzer-Dateiname). Nur PDF/PNG/JPEG; gleiche Datei je Buchung einmal.
CREATE TABLE ticket_files (
  id INTEGER PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id), uploaded_by INTEGER NOT NULL REFERENCES users(id),
  mime TEXT NOT NULL CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  size INTEGER NOT NULL, sha256 TEXT NOT NULL, pages INTEGER, width INTEGER, height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (proposal_id, sha256)
);
