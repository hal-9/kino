-- K05: Felder einer Vorstellung werden aus ihren aktiven Beobachtungen abgeleitet (feste Rangfolge, Herkunft je Feld).
-- Auslastung ist flüchtiger Zustand mit Zeitpunkt statt eines dauerhaften Attributs.
ALTER TABLE screening_observations ADD COLUMN observed_at TEXT; -- Capture-Zeitpunkt der Quelle
ALTER TABLE screening_observations ADD COLUMN capacity TEXT;    -- 'nearly_sold_out' | 'available' | NULL = unbekannt
ALTER TABLE screening_observations ADD COLUMN capacity_at TEXT; -- gesetzt, wenn die Quelle Auslastung meldet (auch als unbekannt)
UPDATE screening_observations SET observed_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at);

ALTER TABLE screenings ADD COLUMN capacity TEXT;
ALTER TABLE screenings ADD COLUMN capacity_at TEXT;
ALTER TABLE screenings ADD COLUMN provenance_json TEXT; -- { feld: { source, observed_at } }

CREATE TABLE screening_changes (
  id INTEGER PRIMARY KEY, screening_id INTEGER NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  field TEXT NOT NULL, old_value TEXT, new_value TEXT, source TEXT, changed_at TEXT NOT NULL
);
CREATE INDEX screening_changes_screening ON screening_changes (screening_id);

-- Das alte, nie verfallende Auslastungs-Attribut entfernen (unbekannt statt „fast ausverkauft“ für immer).
UPDATE screenings SET attrs_json = (SELECT json_group_array(value) FROM json_each(screenings.attrs_json) WHERE value != 'fast ausverkauft')
  WHERE attrs_json LIKE '%fast ausverkauft%';
UPDATE screening_observations SET attrs_json = (SELECT json_group_array(value) FROM json_each(screening_observations.attrs_json) WHERE value != 'fast ausverkauft')
  WHERE attrs_json LIKE '%fast ausverkauft%';
