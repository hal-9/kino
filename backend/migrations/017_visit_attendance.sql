-- K18: Herkunft je Besuch getrennt vom Planungsstatus. manual = selbst eingetragen, inferred = automatisch aus
-- Buchung (✓ bei der gebuchten Vorstellung, nach Buchung eingefroren), confirmed = vom Besitzer bestätigt/korrigiert,
-- legacy = vor K18 automatisch aus ✓-Stimme übernommen (bleibt sichtbar, wird nicht pauschal bestätigt).
ALTER TABLE visits ADD COLUMN attendance TEXT NOT NULL DEFAULT 'manual' CHECK (attendance IN ('manual', 'inferred', 'confirmed', 'legacy'));
UPDATE visits SET attendance = 'legacy'
  WHERE proposal_id IS NOT NULL AND EXISTS (SELECT 1 FROM auto_visits a WHERE a.proposal_id = visits.proposal_id AND a.user_id = visits.user_id);
-- „Nicht dabei“: Grabstein mit Zeitpunkt; ein Lauf legt danach nie wieder einen Besuch an.
ALTER TABLE auto_visits ADD COLUMN skipped_at TEXT;
