-- K15: feste Teilnehmer-Kohorte je Vorschlag, damit Nenner (x von n haben abgestimmt) nicht still wandern,
-- wenn später jemand der Gruppe beitritt. source: snapshot (beim Anlegen), legacy (Rückfüllung), vote (später selbst abgestimmt).
CREATE TABLE proposal_participants (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id), user_id INTEGER NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('snapshot', 'legacy', 'vote')),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (proposal_id, user_id)
);
-- Bestand: wer beim Anlegen schon Mitglied war oder abgestimmt hat.
INSERT INTO proposal_participants (proposal_id, user_id, source)
  SELECT p.id, m.user_id, 'legacy' FROM proposals p JOIN household_members m ON m.household_id = p.household_id
  WHERE datetime(m.joined_at) <= datetime(p.created_at)
     OR EXISTS (SELECT 1 FROM votes v JOIN proposal_options o ON o.id = v.option_id WHERE o.proposal_id = p.id AND v.user_id = m.user_id);
