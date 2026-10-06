-- K31: geprüfte Ticketdaten einer Buchung (nur strukturierte Werte, nie der eingefügte Rohtext).
-- ticket_option_id = gebuchte Option, für die sie eingetragen wurden: nach Umbuchen gelten sie nicht mehr
-- (Verlauf bleibt, nichts wird umgeschrieben). ticket_seats_json = [{ row, seat }], ohne Personenzuordnung.
ALTER TABLE proposals ADD COLUMN ticket_option_id INTEGER REFERENCES proposal_options(id);
ALTER TABLE proposals ADD COLUMN ticket_auditorium TEXT;
ALTER TABLE proposals ADD COLUMN ticket_seats_json TEXT;
ALTER TABLE proposals ADD COLUMN ticket_by INTEGER REFERENCES users(id);
