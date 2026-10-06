# LiLief-Kino

Berliner Kinoprogramm mit OV-Filter und Saalgröße, gemeinsame Terminfindung
(Vorschlag → Abstimmung → Gebucht → Kalender), Besuchslog mit Letterboxd-Sprung
und Jahres-Wrapped. Für eine kleine Gruppe, Registrierung per Einladungscode.

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — vollständiger Bauplan und Handover (M1–M5).
- [docs/PLAN.md](docs/PLAN.md) — Entscheidungen und Datenquellen.
- [docs/DEPLOY.md](docs/DEPLOY.md) — Deploy auf den VPS (Schritt für Schritt).

Stack wie Einkauf: npm workspaces · React + Vite PWA (`frontend/`, Port 5176) ·
Express + better-sqlite3 (`backend/`, Port 3005) · `shared/` für Normalisierung.
