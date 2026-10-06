-- K09: SEQUENCE je Buchung als Zähler statt aus updated_at (Sekundenauflösung → zwei Änderungen in einer Sekunde
-- gaben dieselbe SEQUENCE). Startwert = bisher ausgelieferter Wert, damit Abonnenten nie eine kleinere Zahl sehen.
ALTER TABLE proposals ADD COLUMN ics_seq INTEGER NOT NULL DEFAULT 0;
UPDATE proposals SET ics_seq = CAST(strftime('%s', updated_at) AS INTEGER);
