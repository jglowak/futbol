-- Soporte para importar el histórico de AnWP.
-- IDs antiguos de clubes unificados: varios IDs de AnWP → un club nuestro.
CREATE TABLE club_legacy_ids (
  legacy_id  INTEGER PRIMARY KEY,
  club_id    INTEGER NOT NULL REFERENCES clubs(id)
);
-- Cancha habitual del club (de los estadios de AnWP).
ALTER TABLE clubs ADD COLUMN home_venue TEXT;
-- Tablas históricas cargadas como totales (sin partidos): hacen falta G/E/P además de puntos y goles.
ALTER TABLE standing_adjustments ADD COLUMN won INTEGER NOT NULL DEFAULT 0;
ALTER TABLE standing_adjustments ADD COLUMN drawn INTEGER NOT NULL DEFAULT 0;
ALTER TABLE standing_adjustments ADD COLUMN lost INTEGER NOT NULL DEFAULT 0;
-- Origen de un torneo/tabla (ej. 'anwp') y categoría libre.
ALTER TABLE tournaments ADD COLUMN source TEXT;
ALTER TABLE standing_tables ADD COLUMN legacy_id INTEGER;
-- Los 12 clubes actuales ya tienen legacy_id; se registran también en la tabla de alias.
INSERT INTO club_legacy_ids (legacy_id, club_id) SELECT legacy_id, id FROM clubs WHERE legacy_id IS NOT NULL;
