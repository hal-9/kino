-- K20: Letterboxd-Bewertungen mit Herkunft. letterboxd_entry = guid des RSS-Eintrags (stabile Eintrags-ID),
-- letterboxd_account = Konto beim Verknüpfen (Kontowechsel verknüpft nie still um), manual_rating = eigene
-- Bewertung, schlägt den importierten Wert bis zum ausdrücklichen Zurücksetzen (NULL).
ALTER TABLE visits ADD COLUMN letterboxd_entry TEXT;
ALTER TABLE visits ADD COLUMN letterboxd_account TEXT;
ALTER TABLE visits ADD COLUMN manual_rating REAL CHECK (manual_rating IS NULL OR (manual_rating BETWEEN 0.5 AND 5));
-- Alte Importe: Konto zum Zeitpunkt des Upgrades (nur Herkunft, Wert bleibt).
UPDATE visits SET letterboxd_account = (SELECT u.letterboxd_user FROM users u WHERE u.id = visits.user_id)
  WHERE letterboxd_rating IS NOT NULL;
-- Abgleich-Status je Nutzer: letzter Versuch/Erfolg/Fehler und vom Feed abgedeckter Zeitraum (JSON).
ALTER TABLE users ADD COLUMN letterboxd_attempt_at TEXT;
ALTER TABLE users ADD COLUMN letterboxd_ok_at TEXT;
ALTER TABLE users ADD COLUMN letterboxd_error TEXT;
ALTER TABLE users ADD COLUMN letterboxd_status_json TEXT;
