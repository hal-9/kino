-- K11: Revision je Vorschlag (bedingte Schreibzugriffe: zwei konkurrierende Buchungen → eine gewinnt, eine 409)
-- und Verlauf der Planungs-Übergänge (gebucht/umgebucht/abgesagt/wieder geöffnet). Rein additiv.
ALTER TABLE proposals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE proposal_events (
  id INTEGER PRIMARY KEY, proposal_id INTEGER NOT NULL REFERENCES proposals(id), user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL, revision INTEGER NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX proposal_events_proposal ON proposal_events (proposal_id, id);
