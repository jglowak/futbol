-- URL legible del partido: /partido/atletico-florida-vs-mendoza-15-11-2026
ALTER TABLE matches ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_matches_slug ON matches(slug);
