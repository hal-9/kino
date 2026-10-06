-- K06: Nur ein Sync-Schreiber über Prozesse hinweg (Server-Timer, CLI/Mac-Inbox). token steigt bei jeder
-- Übernahme (Fencing): wer eine ältere Nummer hält, darf nicht mehr committen.
CREATE TABLE sync_lease (
  name TEXT PRIMARY KEY, owner TEXT NOT NULL, token INTEGER NOT NULL, expires_at TEXT NOT NULL
);
