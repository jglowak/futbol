-- Una tabla puede tomar solo una serie/grupo de una etapa ('' = toda la etapa).
-- Así "Clausura Serie A" y "Clausura Serie B" son dos tablas sobre la misma etapa,
-- y la Anual sigue tomando la etapa completa.
ALTER TABLE standing_table_sources ADD COLUMN group_name TEXT NOT NULL DEFAULT '';

-- IDs del sistema anterior (AnWP en WordPress) para poder reimportar sin duplicar.
ALTER TABLE clubs ADD COLUMN legacy_id INTEGER;
ALTER TABLE matches ADD COLUMN legacy_id INTEGER;
ALTER TABLE tournaments ADD COLUMN legacy_id INTEGER;
CREATE UNIQUE INDEX idx_clubs_legacy ON clubs(legacy_id);
CREATE UNIQUE INDEX idx_matches_legacy ON matches(legacy_id);
