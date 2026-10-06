ALTER TABLE proposals ADD COLUMN ticket_link TEXT;
-- Merkt, für wen ein Besuch automatisch angelegt wurde: ein gelöschter Besuch kommt nicht wieder.
CREATE TABLE auto_visits (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id), user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (proposal_id, user_id)
);
