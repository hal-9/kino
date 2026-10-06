-- K17: optionaler Treffpunkt für eine gebuchte Vorstellung (Zeitpunkt mit Offset, Ort, kurze Notiz).
-- Änderungen laufen über Revision + Verlauf; der Buchungs-Snapshot bleibt unverändert.
ALTER TABLE proposals ADD COLUMN meet_at TEXT;
ALTER TABLE proposals ADD COLUMN meet_place TEXT;
ALTER TABLE proposals ADD COLUMN outing_note TEXT;
