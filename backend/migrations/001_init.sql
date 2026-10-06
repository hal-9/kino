CREATE TABLE users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
  password_digest TEXT NOT NULL, letterboxd_user TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE households (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO households (id, name) VALUES (1, 'Kino-Crew');
CREATE TABLE household_members (
  household_id INTEGER NOT NULL REFERENCES households(id), user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (household_id, user_id)
);

CREATE TABLE cinemas (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, chain TEXT, street TEXT, zip TEXT, city TEXT DEFAULT 'Berlin',
  lat REAL, lng REAL, is_favorite INTEGER NOT NULL DEFAULT 0, kinoheld_id INTEGER, kinoheld_slug TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE auditoriums (
  cinema_key TEXT NOT NULL REFERENCES cinemas(key), name TEXT NOT NULL,
  seats INTEGER, screen_width_m REAL, favorite_row TEXT, PRIMARY KEY (cinema_key, name)
);
CREATE TABLE movies (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, norm_title TEXT NOT NULL, title_original TEXT, year INTEGER,
  runtime INTEGER, tmdb_id INTEGER, poster_url TEXT, original_language TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (norm_title, year)
);
CREATE TABLE screenings (
  id INTEGER PRIMARY KEY, cinema_key TEXT NOT NULL REFERENCES cinemas(key), movie_id INTEGER NOT NULL REFERENCES movies(id),
  starts_at TEXT NOT NULL,
  version TEXT CHECK (version IN ('OV','OmU','OmeU','DF') OR version IS NULL),
  auditorium TEXT, attrs_json TEXT NOT NULL DEFAULT '[]', ticket_url TEXT,
  source TEXT NOT NULL, source_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cinema_key, movie_id, starts_at)
);
CREATE INDEX screenings_time ON screenings (starts_at);
CREATE INDEX screenings_movie ON screenings (movie_id, starts_at);
CREATE TABLE source_health (
  source TEXT PRIMARY KEY, last_ok_at TEXT, last_error TEXT, last_error_at TEXT, last_count INTEGER
);

CREATE TABLE proposals (
  id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id),
  movie_id INTEGER NOT NULL REFERENCES movies(id), created_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled')),
  booked_option_id INTEGER, booked_by INTEGER REFERENCES users(id), booked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE proposal_options (
  id INTEGER PRIMARY KEY, proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  screening_id INTEGER REFERENCES screenings(id),
  snapshot_json TEXT NOT NULL
);
CREATE TABLE votes (
  option_id INTEGER NOT NULL REFERENCES proposal_options(id), user_id INTEGER NOT NULL REFERENCES users(id),
  value TEXT NOT NULL CHECK (value IN ('yes','maybe','no')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (option_id, user_id)
);
CREATE TABLE visits (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), household_id INTEGER NOT NULL REFERENCES households(id),
  proposal_id INTEGER REFERENCES proposals(id), movie_id INTEGER REFERENCES movies(id),
  snapshot_json TEXT NOT NULL,
  watched_on TEXT NOT NULL,
  auditorium TEXT, row TEXT, seats TEXT, companions_json TEXT NOT NULL DEFAULT '[]',
  letterboxd_rating REAL, letterboxd_synced_at TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE cal_tokens (user_id INTEGER PRIMARY KEY REFERENCES users(id), token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
