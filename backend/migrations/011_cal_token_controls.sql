-- K10: Neue Kalender-Links nur als SHA-256 gespeichert (hashed = 1). Bestehende Klartext-Links (hashed = 0) bleiben
-- gültig, bis der Nutzer rotiert - kein stilles Abklemmen laufender Abos. include_tickets: Ticket-Links im Feed;
-- Altbestand behält sein bisheriges Verhalten (1), neue Links starten ohne (0, Opt-in).
ALTER TABLE cal_tokens ADD COLUMN hashed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cal_tokens ADD COLUMN include_tickets INTEGER NOT NULL DEFAULT 1;
