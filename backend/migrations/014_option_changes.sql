-- K12: Abweichungen zwischen eingefrorenem Options-Snapshot und aktueller Vorstellung (Zeit/Kino/Saal/Fassung/
-- Verfügbarkeit). Snapshots bleiben unverändert; geprüfte Abweichungen werden quittiert, nicht hineingeschrieben.
-- UNIQUE: dieselbe Abweichung entsteht nur einmal, egal wie oft sie erkannt wird.
CREATE TABLE option_changes (
  id INTEGER PRIMARY KEY, option_id INTEGER NOT NULL REFERENCES proposal_options(id),
  field TEXT NOT NULL, before_value TEXT, after_value TEXT, source TEXT,
  certainty TEXT NOT NULL CHECK (certainty IN ('confirmed', 'uncertain')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT, acknowledged_by INTEGER REFERENCES users(id),
  UNIQUE (option_id, field, after_value)
);
