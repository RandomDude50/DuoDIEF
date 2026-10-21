-- QuizDuel: schema database (SQLite). Per PostgreSQL: INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL/IDENTITY,
-- TEXT JSON -> JSONB, datetime('now') -> now().

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  elo           INTEGER NOT NULL DEFAULT 1000,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);

-- active = 0: topic "cancellato" (soft delete). Non compare nel gioco, ma le partite storiche restano leggibili.
CREATE TABLE IF NOT EXISTS topics (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id      INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  options       TEXT NOT NULL,            -- array JSON di 4 stringhe
  correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation   TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))  -- 0 = soft delete, vedi match_answers
);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);

-- Una partita conclusa
CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id      INTEGER NOT NULL REFERENCES topics(id),
  n_questions   INTEGER NOT NULL,
  time_limit_s  INTEGER NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Risultato di ogni giocatore in una partita (include variazione ELO)
CREATE TABLE IF NOT EXISTS match_players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  placement       INTEGER NOT NULL,
  score           INTEGER NOT NULL,
  correct_count   INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  avg_time_ms     INTEGER NOT NULL,
  elo_before      INTEGER NOT NULL,
  elo_after       INTEGER NOT NULL,
  UNIQUE (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_user ON match_players(user_id);

-- Dettaglio di ogni risposta (resoconto personale)
CREATE TABLE IF NOT EXISTS match_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id     INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  question_id  INTEGER NOT NULL REFERENCES questions(id),
  position     INTEGER NOT NULL,          -- ordine della domanda nella partita
  chosen_index INTEGER,                   -- NULL = nessuna risposta (tempo scaduto)
  is_correct   INTEGER NOT NULL,
  time_ms      INTEGER NOT NULL,
  points       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ma_match_user ON match_answers(match_id, user_id);
