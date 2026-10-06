-- K07: Wiederholte Anlege-Anfragen (Netzabbruch nach Commit, Doppeltipp) liefern das Original statt eines Duplikats.
-- Schlüssel je Nutzer; request_hash bindet ihn an Aktion + Inhalt.
CREATE TABLE idempotency_keys (
  user_id INTEGER NOT NULL REFERENCES users(id), key TEXT NOT NULL, action TEXT NOT NULL, request_hash TEXT NOT NULL,
  status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
