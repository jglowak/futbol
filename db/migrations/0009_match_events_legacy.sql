-- Referencia al jugador de AnWP en eventos importados (id numérico o 'temp__N'), para enlazar
-- cuando se importen los jugadores.
ALTER TABLE match_events ADD COLUMN legacy_player_ref TEXT;
ALTER TABLE match_events ADD COLUMN legacy_event_id TEXT;
CREATE UNIQUE INDEX idx_match_events_legacy ON match_events(legacy_event_id);
