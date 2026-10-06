-- K27: Interesse an einem Film (Merkliste) unabhängig von Vorschlägen/Stimmen/Buchungen; auch ohne aktuelle Vorstellungen.
CREATE TABLE watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id), movie_id INTEGER NOT NULL REFERENCES movies(id),
  expires_on TEXT, -- optional: Berliner Datum, danach zählt das Interesse nicht mehr
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, movie_id)
);
-- Planungs-Vorlieben je Person (JSON, serverseitig validiert). visibility: fit_only = andere sehen nur die abgeleitete
-- Passung (passt/passt nicht/unbekannt), household = Vorlieben selbst für den Haushalt sichtbar.
CREATE TABLE planning_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), prefs_json TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'fit_only' CHECK (visibility IN ('fit_only', 'household')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Manuell eingetragene Zeiträume als echte Zeitpunkte (UTC); free = kann, busy = kann nicht. Ohne Eintrag: unbekannt.
CREATE TABLE availability (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('free', 'busy')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX availability_user ON availability (user_id, ends_at);
