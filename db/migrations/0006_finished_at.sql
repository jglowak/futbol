-- Momento en que se dio por finalizado el partido (para mostrar "Finalizado" con hora).
ALTER TABLE matches ADD COLUMN finished_at TEXT;
UPDATE matches SET finished_at = COALESCE(kickoff_at, updated_at) WHERE status = 'finished' AND finished_at IS NULL;
