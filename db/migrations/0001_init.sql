-- Esquema inicial de "futbol".
-- Principios:
--  * Todo está relacionado (club ↔ partido ↔ torneo ↔ jugador) para que las
--    páginas de club/torneo/jugador se generen solas.
--  * Una TABLA de posiciones es una vista configurable (standing_tables) sobre
--    una o varias ETAPAS: así "Anual = Apertura + Clausura" no es un caso especial.
--  * NO se guarda la cédula de identidad de nadie. El jugador se identifica por
--    su ficha oficial (ficha_oficial), que es un identificador de registro.

PRAGMA foreign_keys = ON;

CREATE TABLE clubs (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  short_name    TEXT,
  city          TEXT,
  founded_year  INTEGER,
  crest_url     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE seasons (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  year  INTEGER NOT NULL
);

CREATE TABLE tournaments (
  id         INTEGER PRIMARY KEY,
  season_id  INTEGER NOT NULL REFERENCES seasons(id),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Absoluta',
  -- plantilla usada al crearlo: 'apertura_clausura', 'copa_eliminatoria', 'custom'...
  template   TEXT NOT NULL DEFAULT 'custom',
  status     TEXT NOT NULL DEFAULT 'upcoming'
             CHECK (status IN ('upcoming', 'ongoing', 'finished')),
  starts_on  TEXT,
  ends_on    TEXT
);
CREATE INDEX idx_tournaments_season ON tournaments(season_id);

-- Un torneo se compone de etapas ordenadas (liga, grupos, eliminatoria...).
-- config (JSON): reglas propias de la etapa (ida y vuelta, clasificados, etc.).
CREATE TABLE stages (
  id             INTEGER PRIMARY KEY,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id),
  position       INTEGER NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('league', 'groups', 'knockout')),
  config         TEXT NOT NULL DEFAULT '{}',
  UNIQUE (tournament_id, position)
);

-- Participantes de una etapa (y su grupo/serie, '' si no hay).
CREATE TABLE stage_clubs (
  stage_id    INTEGER NOT NULL REFERENCES stages(id),
  club_id     INTEGER NOT NULL REFERENCES clubs(id),
  group_name  TEXT NOT NULL DEFAULT '',
  seed        INTEGER,
  PRIMARY KEY (stage_id, club_id)
);

CREATE TABLE matches (
  id            INTEGER PRIMARY KEY,
  stage_id      INTEGER NOT NULL REFERENCES stages(id),
  round         TEXT NOT NULL DEFAULT '',
  group_name    TEXT NOT NULL DEFAULT '',
  home_club_id  INTEGER NOT NULL REFERENCES clubs(id),
  away_club_id  INTEGER NOT NULL REFERENCES clubs(id),
  kickoff_at    TEXT,                       -- ISO 8601 (UTC)
  venue         TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  -- Marcador. Si hay eventos de gol, la app lo recalcula desde ellos;
  -- si Jorge carga solo el resultado, se guarda directo acá.
  home_goals    INTEGER,
  away_goals    INTEGER,
  home_pens     INTEGER,
  away_pens     INTEGER,
  minute        INTEGER,                    -- minuto actual si está en vivo
  notes         TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (home_club_id <> away_club_id)
);
CREATE INDEX idx_matches_stage   ON matches(stage_id);
CREATE INDEX idx_matches_kickoff ON matches(kickoff_at);
CREATE INDEX idx_matches_status  ON matches(status);
CREATE INDEX idx_matches_home    ON matches(home_club_id);
CREATE INDEX idx_matches_away    ON matches(away_club_id);

-- Jugadores. Sin cédula ni fecha de nacimiento (datos personales, menores).
CREATE TABLE players (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  full_name      TEXT NOT NULL,
  ficha_oficial  TEXT UNIQUE,
  photo_url      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plantel de un club en una temporada.
CREATE TABLE squads (
  season_id     INTEGER NOT NULL REFERENCES seasons(id),
  club_id       INTEGER NOT NULL REFERENCES clubs(id),
  player_id     INTEGER NOT NULL REFERENCES players(id),
  shirt_number  INTEGER,
  PRIMARY KEY (season_id, club_id, player_id)
);

-- Alineación de un partido (titulares y suplentes), tal como figura en la planilla.
CREATE TABLE lineups (
  match_id       INTEGER NOT NULL REFERENCES matches(id),
  club_id        INTEGER NOT NULL REFERENCES clubs(id),
  player_id      INTEGER NOT NULL REFERENCES players(id),
  shirt_number   INTEGER,
  is_starter     INTEGER NOT NULL DEFAULT 0,
  is_captain     INTEGER NOT NULL DEFAULT 0,
  is_goalkeeper  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE match_events (
  id                 INTEGER PRIMARY KEY,
  match_id           INTEGER NOT NULL REFERENCES matches(id),
  club_id            INTEGER NOT NULL REFERENCES clubs(id),
  player_id          INTEGER REFERENCES players(id),
  related_player_id  INTEGER REFERENCES players(id),   -- ej. quien sale en un cambio
  type               TEXT NOT NULL CHECK (type IN
                       ('goal', 'penalty_goal', 'own_goal', 'yellow_card', 'red_card', 'sub')),
  minute             INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         TEXT
);
CREATE INDEX idx_events_match  ON match_events(match_id);
CREATE INDEX idx_events_player ON match_events(player_id);

-- Tablas de posiciones: vistas configurables sobre una o más etapas.
-- config (JSON), ej.:
--   {"points":{"win":3,"draw":1,"loss":0},
--    "tiebreakers":["goal_difference","goals_for"]}
CREATE TABLE standing_tables (
  id         INTEGER PRIMARY KEY,
  season_id  INTEGER REFERENCES seasons(id),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE standing_table_sources (
  table_id  INTEGER NOT NULL REFERENCES standing_tables(id),
  stage_id  INTEGER NOT NULL REFERENCES stages(id),
  PRIMARY KEY (table_id, stage_id)
);

-- Ajustes manuales (puntos o goles iniciales, sanciones), siempre con motivo.
CREATE TABLE standing_adjustments (
  id             INTEGER PRIMARY KEY,
  table_id       INTEGER NOT NULL REFERENCES standing_tables(id),
  club_id        INTEGER NOT NULL REFERENCES clubs(id),
  points         INTEGER NOT NULL DEFAULT 0,
  goals_for      INTEGER NOT NULL DEFAULT 0,
  goals_against  INTEGER NOT NULL DEFAULT 0,
  played         INTEGER NOT NULL DEFAULT 0,
  reason         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_adjustments_table ON standing_adjustments(table_id);

-- Títulos: se derivan de finales registradas, pero también se pueden cargar a mano
-- para temporadas viejas sin datos de partidos (manual = 1).
CREATE TABLE titles (
  id             INTEGER PRIMARY KEY,
  club_id        INTEGER NOT NULL REFERENCES clubs(id),
  season_id      INTEGER REFERENCES seasons(id),
  tournament_id  INTEGER REFERENCES tournaments(id),
  label          TEXT NOT NULL,
  manual         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_titles_club ON titles(club_id);

-- Historial de cambios (quién cambió qué y cuándo) para poder revertir errores de carga.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  entity     TEXT NOT NULL,
  entity_id  INTEGER NOT NULL,
  action     TEXT NOT NULL,
  payload    TEXT,
  actor      TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
