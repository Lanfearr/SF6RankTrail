PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  short_id      TEXT PRIMARY KEY,
  cfn           TEXT,
  display_name  TEXT,
  is_self       INTEGER NOT NULL DEFAULT 0,
  last_synced   INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  replay_id     TEXT PRIMARY KEY,
  short_id      TEXT NOT NULL REFERENCES players(short_id),
  opponent_id   TEXT,
  my_char       TEXT,
  opp_char      TEXT,
  result        TEXT NOT NULL CHECK (result IN ('win','loss','draw')),
  my_mr         INTEGER,
  opp_mr        INTEGER,
  my_lp         INTEGER,
  opp_lp        INTEGER,
  played_at     INTEGER NOT NULL,
  season        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_short_time
  ON matches(short_id, played_at DESC);

CREATE TABLE IF NOT EXISTS rating_points (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id      TEXT NOT NULL REFERENCES players(short_id),
  character     TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('LP','MR')),
  value         INTEGER NOT NULL,
  source        TEXT NOT NULL,
  estimated     INTEGER NOT NULL DEFAULT 0,
  observed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rating_short_kind_time
  ON rating_points(short_id, kind, observed_at);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id      TEXT NOT NULL REFERENCES players(short_id),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  start_rating  INTEGER,
  end_rating    INTEGER,
  start_lp      INTEGER,
  end_lp        INTEGER
);

CREATE TABLE IF NOT EXISTS session_marks (
  short_id      TEXT PRIMARY KEY REFERENCES players(short_id),
  started_at    INTEGER NOT NULL,
  start_mr      INTEGER,
  start_lp      INTEGER,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
