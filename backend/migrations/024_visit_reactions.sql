-- K35: kurze Reaktion je eigenem Besuch, getrennt von Bewertungen (K20 bleibt maßgeblich). Standard privat.
-- reveal = „gemeinsam aufdecken“: andere Teilnehmende derselben Buchung sehen sie erst, wenn sie selbst eine
-- nicht-private Reaktion abgegeben haben; household = für den Haushalt sichtbar. spoiler = nur aufgeklappt zeigen.
CREATE TABLE visit_reactions (
  visit_id INTEGER PRIMARY KEY REFERENCES visits(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  line TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'reveal', 'household')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
