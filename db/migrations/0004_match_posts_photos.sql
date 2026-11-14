-- Relato del partido (entradas con minuto y texto libre) y fotos.
CREATE TABLE match_posts (
  id          INTEGER PRIMARY KEY,
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  minute      INTEGER,
  kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'goal', 'card', 'sub', 'start', 'end', 'info')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX idx_match_posts_match ON match_posts(match_id, id);

CREATE TABLE match_photos (
  id          INTEGER PRIMARY KEY,
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  key         TEXT NOT NULL,          -- clave en R2 (se sirve en /media/<key>)
  caption     TEXT,
  width       INTEGER,
  height      INTEGER,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX idx_match_photos_match ON match_photos(match_id, position, id);
