// Goleadores de un torneo. Cuenta solo goles de juego (incluido el de penal); NO la tanda de
// penales de una definición (esos son home_pens/away_pens del partido, no eventos) ni los goles en contra.
import { env } from 'cloudflare:workers';

export interface ScorerRow {
  fullName: string;
  slug: string;
  clubName: string;
  clubShort: string | null;
  crestUrl: string | null;
  goals: number;
}

export async function topScorers(tournamentId: number, limit = 30): Promise<ScorerRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.full_name AS fullName, p.slug AS slug,
            c.name AS clubName, c.short_name AS clubShort, c.crest_url AS crestUrl,
            COUNT(*) AS goals
     FROM match_events e
     JOIN matches m ON m.id = e.match_id
     JOIN stages s ON s.id = m.stage_id
     JOIN players p ON p.id = e.player_id
     JOIN clubs c ON c.id = e.club_id
     WHERE s.tournament_id = ? AND e.type IN ('goal', 'penalty_goal')
     GROUP BY p.id, e.club_id
     ORDER BY goals DESC, p.full_name
     LIMIT ?`,
  )
    .bind(tournamentId, limit)
    .all<ScorerRow>();
  return results;
}
