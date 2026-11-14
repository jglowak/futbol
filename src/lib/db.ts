import { env } from 'cloudflare:workers';
import {
  computeStandings,
  type AdjustmentInput,
  type ClubInput,
  type MatchInput,
  type StandingRow,
  type StandingsConfig,
} from './standings';

export interface TournamentRow {
  id: number;
  slug: string;
  name: string;
  category: string;
  status: string;
  season_name: string;
}

export interface MatchRow {
  id: number;
  round: string;
  group_name: string;
  kickoff_at: string | null;
  venue: string | null;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  home_pens: number | null;
  away_pens: number | null;
  minute: number | null;
  home_id: number;
  home_name: string;
  home_slug: string;
  away_id: number;
  away_name: string;
  away_slug: string;
  tournament_name: string;
  tournament_slug: string;
}

export interface TableRow {
  id: number;
  slug: string;
  name: string;
  config: string;
}

const MATCH_SELECT = `
  SELECT m.id, m.round, m.group_name, m.kickoff_at, m.venue, m.status,
         m.home_goals, m.away_goals, m.home_pens, m.away_pens, m.minute,
         h.id AS home_id, h.name AS home_name, h.slug AS home_slug,
         a.id AS away_id, a.name AS away_name, a.slug AS away_slug,
         t.name AS tournament_name, t.slug AS tournament_slug
  FROM matches m
  JOIN clubs h ON h.id = m.home_club_id
  JOIN clubs a ON a.id = m.away_club_id
  JOIN stages s ON s.id = m.stage_id
  JOIN tournaments t ON t.id = s.tournament_id
`;

export async function listTournaments(): Promise<TournamentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.slug, t.name, t.category, t.status, s.name AS season_name
     FROM tournaments t JOIN seasons s ON s.id = t.season_id
     ORDER BY s.year DESC, t.id DESC`,
  ).all<TournamentRow>();
  return results;
}

export async function getTournament(slug: string): Promise<TournamentRow | null> {
  return env.DB.prepare(
    `SELECT t.id, t.slug, t.name, t.category, t.status, s.name AS season_name
     FROM tournaments t JOIN seasons s ON s.id = t.season_id
     WHERE t.slug = ?`,
  )
    .bind(slug)
    .first<TournamentRow>();
}

export async function getTournamentMatches(tournamentId: number): Promise<MatchRow[]> {
  const { results } = await env.DB.prepare(
    `${MATCH_SELECT} WHERE t.id = ? ORDER BY m.kickoff_at, m.id`,
  )
    .bind(tournamentId)
    .all<MatchRow>();
  return results;
}

/** Últimos resultados y próximos partidos, para la franja de la portada. */
export async function getStripMatches(): Promise<{ recent: MatchRow[]; upcoming: MatchRow[] }> {
  const [recent, upcoming] = await Promise.all([
    env.DB.prepare(`${MATCH_SELECT} WHERE m.status IN ('finished','live') ORDER BY m.kickoff_at DESC LIMIT 6`).all<MatchRow>(),
    env.DB.prepare(`${MATCH_SELECT} WHERE m.status = 'scheduled' ORDER BY m.kickoff_at ASC LIMIT 6`).all<MatchRow>(),
  ]);
  return { recent: recent.results, upcoming: upcoming.results };
}

export async function getTablesForTournament(tournamentId: number): Promise<TableRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT st.id, st.slug, st.name, st.config
     FROM standing_tables st
     JOIN standing_table_sources src ON src.table_id = st.id
     JOIN stages s ON s.id = src.stage_id
     WHERE s.tournament_id = ?
     ORDER BY st.id`,
  )
    .bind(tournamentId)
    .all<TableRow>();
  return results;
}

export interface ComputedTable {
  table: TableRow;
  rows: StandingRow[];
}

/** Calcula una tabla (de una o varias etapas) con sus ajustes manuales. */
export async function getComputedTable(slug: string): Promise<ComputedTable | null> {
  const table = await env.DB.prepare(
    `SELECT id, slug, name, config FROM standing_tables WHERE slug = ?`,
  )
    .bind(slug)
    .first<TableRow>();
  if (!table) return null;

  const [clubsRes, matchesRes, adjRes] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT c.id, c.name
       FROM stage_clubs sc
       JOIN standing_table_sources src ON src.stage_id = sc.stage_id
       JOIN clubs c ON c.id = sc.club_id
       WHERE src.table_id = ?`,
    )
      .bind(table.id)
      .all<ClubInput>(),
    env.DB.prepare(
      `SELECT m.home_club_id AS homeClubId, m.away_club_id AS awayClubId,
              m.home_goals AS homeGoals, m.away_goals AS awayGoals, m.status
       FROM matches m
       JOIN standing_table_sources src ON src.stage_id = m.stage_id
       WHERE src.table_id = ?`,
    )
      .bind(table.id)
      .all<MatchInput>(),
    env.DB.prepare(
      `SELECT club_id AS clubId, points, goals_for AS goalsFor,
              goals_against AS goalsAgainst, played, reason
       FROM standing_adjustments WHERE table_id = ?`,
    )
      .bind(table.id)
      .all<AdjustmentInput>(),
  ]);

  let config: StandingsConfig = {};
  try {
    config = JSON.parse(table.config) as StandingsConfig;
  } catch {
    // config inválida: se usan los valores por defecto
  }

  return {
    table,
    rows: computeStandings(clubsRes.results, matchesRes.results, adjRes.results, config),
  };
}
