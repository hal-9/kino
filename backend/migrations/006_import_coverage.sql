-- K04: Abwesenheit wird weich (withdrawn_at) statt gelöscht und nur in vollständig gemeldeten Scopes gezählt.
ALTER TABLE screening_observations ADD COLUMN missing_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE screening_observations ADD COLUMN missing_since TEXT;
ALTER TABLE screening_observations ADD COLUMN withdrawn_at TEXT;
ALTER TABLE screenings ADD COLUMN withdrawn_at TEXT;

-- last_ok_at = letzter erfolgreicher Import (auch teilweise). Getrennt davon: Versuch, Capture-Zeitpunkt,
-- letzter vollständiger Import und Digest des zuletzt gezählten vollständigen Captures.
ALTER TABLE source_health ADD COLUMN last_attempt_at TEXT;
ALTER TABLE source_health ADD COLUMN last_captured_at TEXT;
ALTER TABLE source_health ADD COLUMN last_complete_import_at TEXT;
ALTER TABLE source_health ADD COLUMN last_digest TEXT;
