-- K19: TMDB-Zuordnung mit Zustand statt Dauer-Zeitstempel. matched/manual = tmdb_id gesetzt (manual: von Hand,
-- wird nie automatisch überschrieben); not_found/ambiguous laufen nach tmdb_next_retry_at ab; failed mit Backoff.
ALTER TABLE movies ADD COLUMN tmdb_status TEXT CHECK (tmdb_status IN ('matched', 'not_found', 'ambiguous', 'failed', 'manual'));
ALTER TABLE movies ADD COLUMN tmdb_attempt_at TEXT;
ALTER TABLE movies ADD COLUMN tmdb_next_retry_at TEXT;
ALTER TABLE movies ADD COLUMN tmdb_failures INTEGER NOT NULL DEFAULT 0;
UPDATE movies SET tmdb_status = 'matched' WHERE tmdb_id IS NOT NULL;
-- F12: ein früherer Fehltreffer setzte details_fetched_at dauerhaft; diese Filme sind sofort wieder versuchbar.
UPDATE movies SET tmdb_status = 'not_found', tmdb_attempt_at = COALESCE(details_fetched_at, tmdb_checked_at), details_fetched_at = NULL
  WHERE tmdb_id IS NULL AND (details_fetched_at IS NOT NULL OR tmdb_checked_at IS NOT NULL);
