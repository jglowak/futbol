-- Llaves (semifinales, finales, finales condicionales) cuyos participantes se
-- definen por referencia a tablas u otras llaves, y que pueden tener una
-- condición para jugarse (art. 5 del reglamento LFF 2026).
CREATE TABLE ties (
  id                     INTEGER PRIMARY KEY,
  stage_id               INTEGER NOT NULL REFERENCES stages(id),
  position               INTEGER NOT NULL,
  code                   TEXT NOT NULL UNIQUE,   -- ej. 'clausura-2026-sf1'
  label                  TEXT NOT NULL,          -- ej. 'Semifinal 1'
  home_ref               TEXT NOT NULL,          -- JSON (ver src/lib/phases-core.ts)
  away_ref               TEXT NOT NULL,          -- JSON
  condition              TEXT,                   -- JSON o NULL (siempre se juega)
  neutral                INTEGER NOT NULL DEFAULT 0,
  home_override_club_id  INTEGER REFERENCES clubs(id),
  away_override_club_id  INTEGER REFERENCES clubs(id),
  match_id               INTEGER REFERENCES matches(id),
  note                   TEXT
);
CREATE INDEX idx_ties_stage ON ties(stage_id, position);

-- Desempates manuales de una tabla: {"1": clubId} fija qué club ocupa la posición 1
-- cuando hay igualdad (partido de desempate, fair play o sorteo, art. 12).
ALTER TABLE standing_tables ADD COLUMN position_overrides TEXT NOT NULL DEFAULT '{}';

-- Temporada: configuración de la definición y cierre.
ALTER TABLE seasons ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE seasons ADD COLUMN closed_at TEXT;

-- ===== Temporada 2026: etapas de definición =====
-- Clausura: semifinales (etapa 3) y final (etapa 4)
INSERT INTO stages (id, tournament_id, position, name, kind, config) VALUES (3, 2, 2, 'Semifinales', 'knockout', '{"legs":1,"extra_time":true,"penalties":true}');
INSERT INTO stages (id, tournament_id, position, name, kind, config) VALUES (4, 2, 3, 'Final', 'knockout', '{"legs":1,"extra_time":true,"penalties":true,"neutral":true}');

INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, neutral) VALUES
  (3, 1, 'clausura-2026-sf1', 'Semifinal 1',
   '{"type":"table_rank","table":"clausura-2026-serie-a","rank":1}',
   '{"type":"table_rank","table":"clausura-2026-serie-b","rank":2}', 0),
  (3, 2, 'clausura-2026-sf2', 'Semifinal 2',
   '{"type":"table_rank","table":"clausura-2026-serie-b","rank":1}',
   '{"type":"table_rank","table":"clausura-2026-serie-a","rank":2}', 0),
  (4, 1, 'clausura-2026-final', 'Final del Clausura',
   '{"type":"tie_winner","tie":"clausura-2026-sf1"}',
   '{"type":"tie_winner","tie":"clausura-2026-sf2"}', 1);

-- Definición de la temporada (torneo propio, para que tenga su página y su llave)
INSERT INTO tournaments (id, season_id, slug, name, category, template, status)
  VALUES (3, 1, 'temporada-2026', 'Definición de la Temporada 2026', 'Absoluta', 'lff_temporada', 'upcoming');
INSERT INTO stages (id, tournament_id, position, name, kind, config) VALUES (5, 3, 1, 'Finales', 'knockout', '{"legs":1,"extra_time":true,"penalties":true,"neutral":true}');

-- B) Campeón del Apertura vs campeón del Clausura, solo si son distintos.
INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, condition, neutral, note) VALUES
  (5, 1, 'temporada-2026-final', 'Final de la Temporada',
   '{"type":"table_rank","table":"apertura-2026","rank":1}',
   '{"type":"tie_winner","tie":"clausura-2026-final"}',
   '{"type":"distinct","a":{"type":"table_rank","table":"apertura-2026","rank":1},"b":{"type":"tie_winner","tie":"clausura-2026-final"}}',
   1, 'Se juega solo si el campeón del Apertura y el del Clausura son distintos (art. 5 B).'),
-- C) Si el perdedor de B es el 1° de la Anual, tiene derecho a una final extra.
  (5, 2, 'temporada-2026-final-extra', 'Final extra',
   '{"type":"tie_loser","tie":"temporada-2026-final"}',
   '{"type":"tie_winner","tie":"temporada-2026-final"}',
   '{"type":"equals","a":{"type":"tie_loser","tie":"temporada-2026-final"},"b":{"type":"table_rank","table":"anual-2026","rank":1}}',
   1, 'Se juega solo si el perdedor de la Final es el 1° de la Tabla Anual (art. 5 C).'),
-- D) Si el 1° de la Anual no es ninguno de los campeones, juega la final con el ganador de B.
  (5, 3, 'temporada-2026-final-anual', 'Final con el 1° de la Anual',
   '{"type":"table_rank","table":"anual-2026","rank":1}',
   '{"type":"tie_winner","tie":"temporada-2026-final"}',
   '{"type":"not_in","ref":{"type":"table_rank","table":"anual-2026","rank":1},"set":[{"type":"table_rank","table":"apertura-2026","rank":1},{"type":"tie_winner","tie":"clausura-2026-final"}]}',
   1, 'Se juega solo si el 1° de la Tabla Anual no es campeón del Apertura ni del Clausura (art. 5 D).');

UPDATE seasons SET config = '{"relegation":2,"ofi_slots":2,"definition":{"apertura_table":"apertura-2026","clausura_final":"clausura-2026-final","anual_table":"anual-2026","final":"temporada-2026-final","final_extra":"temporada-2026-final-extra","final_anual":"temporada-2026-final-anual"}}' WHERE id = 1;
