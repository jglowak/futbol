// Conexión del motor de fases con la base: carga el contexto de una temporada,
// calcula el estado de las llaves y permite crear el partido de una llave.
import { env } from 'cloudflare:workers';
import { getComputedTable } from './db';
import { computeMatchSlug } from './fixture-admin';
import {
  computeAllTies,
  seasonSummary,
  type Condition,
  type Context,
  type Ref,
  type SeasonDefinitionConfig,
  type SeasonSummary,
  type TableInfo,
  type TieDef,
  type TieMatch,
  type TieState,
} from './phases-core';

export interface TieRow extends TieDef {
  id: number;
  stage_id: number;
  position: number;
  note: string | null;
}

export interface SeasonConfig {
  relegation?: number;
  ofi_slots?: number;
  definition?: SeasonDefinitionConfig;
}

export interface SeasonRow {
  id: number;
  slug: string;
  name: string;
  year: number;
  config: SeasonConfig;
  closed_at: string | null;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getSeason(seasonId: number): Promise<SeasonRow | null> {
  const r = await env.DB.prepare(`SELECT id, slug, name, year, config, closed_at FROM seasons WHERE id = ?`).bind(seasonId).first<{
    id: number; slug: string; name: string; year: number; config: string; closed_at: string | null;
  }>();
  return r ? { ...r, config: parseJson<SeasonConfig>(r.config, {}) } : null;
}

export async function tiesOfSeason(seasonId: number): Promise<TieRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.stage_id, t.position, t.code, t.label, t.home_ref, t.away_ref, t.condition, t.neutral,
            t.home_override_club_id, t.away_override_club_id, t.match_id, t.note
     FROM ties t JOIN stages s ON s.id = t.stage_id JOIN tournaments tr ON tr.id = s.tournament_id
     WHERE tr.season_id = ? ORDER BY tr.id, s.position, t.position`,
  ).bind(seasonId).all<{
    id: number; stage_id: number; position: number; code: string; label: string; home_ref: string; away_ref: string;
    condition: string | null; neutral: number; home_override_club_id: number | null; away_override_club_id: number | null;
    match_id: number | null; note: string | null;
  }>();
  return results.map((r) => ({
    ...r,
    neutral: Boolean(r.neutral),
    home_ref: parseJson<Ref>(r.home_ref, { type: 'club', club: 0 }),
    away_ref: parseJson<Ref>(r.away_ref, { type: 'club', club: 0 }),
    condition: parseJson<Condition | null>(r.condition, null),
  }));
}

/** Nombres de tablas referenciadas por las llaves (y las de la definición de temporada). */
function tablesReferenced(ties: TieDef[], cfg?: SeasonDefinitionConfig): Set<string> {
  const out = new Set<string>();
  const walk = (r: Ref) => { if (r.type === 'table_rank') out.add(r.table); };
  const walkCond = (c: Condition | null) => {
    if (!c) return;
    if (c.type === 'not_in') { walk(c.ref); c.set.forEach(walk); } else { walk(c.a); walk(c.b); }
  };
  for (const t of ties) { walk(t.home_ref); walk(t.away_ref); walkCond(t.condition); }
  if (cfg) { out.add(cfg.apertura_table); out.add(cfg.anual_table); }
  return out;
}

async function loadTable(slug: string): Promise<TableInfo | null> {
  // Las tres consultas van en paralelo (por slug) para no sumar viajes a D1 uno tras otro.
  const [computed, pending, raw] = await Promise.all([
    getComputedTable(slug),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM matches m
       JOIN standing_table_sources src ON src.stage_id = m.stage_id AND (src.group_name = '' OR src.group_name = m.group_name)
       JOIN standing_tables st ON st.id = src.table_id
       WHERE st.slug = ? AND m.status <> 'finished' AND m.status <> 'cancelled'`,
    ).bind(slug).first<{ n: number }>(),
    env.DB.prepare(`SELECT position_overrides FROM standing_tables WHERE slug = ?`).bind(slug).first<{ position_overrides: string }>(),
  ]);
  if (!computed) return null;
  return {
    name: computed.table.name,
    rows: computed.rows,
    pending: pending?.n ?? 0,
    positionOverrides: parseJson<Record<string, number>>(raw?.position_overrides, {}),
  };
}

export interface SeasonContext {
  season: SeasonRow;
  ctx: Context;
  ties: TieRow[];
  states: Map<string, TieState>;
  summary: SeasonSummary | null;
  clubs: Map<number, { id: number; name: string; short_name: string | null; slug: string; crest_url: string | null }>;
}

export async function loadSeasonContext(seasonId: number): Promise<SeasonContext | null> {
  // Todo lo que no depende de lo demás se pide a la vez (D1 está lejos: cada viaje en serie suma latencia).
  const [season, ties, tieMatchRows, clubsRes] = await Promise.all([
    getSeason(seasonId),
    tiesOfSeason(seasonId),
    env.DB.prepare(
      `SELECT m.id, m.status, m.home_club_id, m.away_club_id, m.home_goals, m.away_goals, m.home_pens, m.away_pens
       FROM matches m
       WHERE m.id IN (
         SELECT t.match_id FROM ties t JOIN stages s ON s.id = t.stage_id JOIN tournaments tr ON tr.id = s.tournament_id
         WHERE tr.season_id = ? AND t.match_id IS NOT NULL
       )`,
    ).bind(seasonId).all<TieMatch>(),
    env.DB.prepare(`SELECT id, name, short_name, slug, crest_url FROM clubs`).all<{ id: number; name: string; short_name: string | null; slug: string; crest_url: string | null }>(),
  ]);
  if (!season) return null;
  const tableSlugs = [...tablesReferenced(ties, season.config.definition)];
  const loaded = await Promise.all(tableSlugs.map((slug) => loadTable(slug)));
  const tables = new Map<string, TableInfo>();
  tableSlugs.forEach((slug, i) => { const t = loaded[i]; if (t) tables.set(slug, t); });
  const matches = new Map<number, TieMatch>(tieMatchRows.results.map((m) => [m.id, m]));
  const ctx: Context = { tables, ties, matches };
  const states = computeAllTies(ctx);
  const summary = season.config.definition ? seasonSummary(season.config.definition, ctx) : null;
  return { season, ctx, ties, states, summary, clubs: new Map(clubsRes.results.map((c) => [c.id, c])) };
}

export async function seasonIdOfTournament(tournamentId: number): Promise<number | null> {
  const r = await env.DB.prepare(`SELECT season_id FROM tournaments WHERE id = ?`).bind(tournamentId).first<{ season_id: number }>();
  return r?.season_id ?? null;
}

/** Crea el partido de una llave lista (participantes conocidos) y lo enlaza. */
export async function createTieMatch(
  tieId: number,
  opts: { kickoff_at: string | null; venue: string | null },
  actor: string,
): Promise<{ ok: true; matchId: number } | { ok: false; error: string }> {
  const tie = await env.DB.prepare(`SELECT t.*, s.tournament_id FROM ties t JOIN stages s ON s.id = t.stage_id WHERE t.id = ?`).bind(tieId).first<{ id: number; stage_id: number; code: string; label: string; match_id: number | null; tournament_id: number }>();
  if (!tie) return { ok: false, error: 'Llave no encontrada' };
  if (tie.match_id) return { ok: false, error: 'La llave ya tiene partido' };
  const seasonId = await seasonIdOfTournament(tie.tournament_id);
  const sc = seasonId ? await loadSeasonContext(seasonId) : null;
  const st = sc?.states.get(tie.code);
  if (!st) return { ok: false, error: 'No se pudo calcular la llave' };
  if (st.status === 'not_needed') return { ok: false, error: 'Según el reglamento esta llave no se juega' };
  if (st.home.club === null || st.away.club === null) return { ok: false, error: `Todavía no se conocen los dos participantes (${st.home.reason ?? st.away.reason ?? 'pendiente'})` };
  if (st.conditionMet !== true) return { ok: false, error: 'Todavía no se sabe si esta llave se juega' };

  const slug = await computeMatchSlug(st.home.club, st.away.club, opts.kickoff_at, undefined, tie.stage_id);
  const row = await env.DB.prepare(
    `INSERT INTO matches (stage_id, round, group_name, home_club_id, away_club_id, kickoff_at, venue, slug) VALUES (?, ?, '', ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(tie.stage_id, tie.label, st.home.club, st.away.club, opts.kickoff_at, opts.venue, slug).first<{ id: number }>();
  await env.DB.batch([
    env.DB.prepare(`UPDATE ties SET match_id = ? WHERE id = ?`).bind(row!.id, tieId),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('tie', ?, 'create_match', ?, ?)`).bind(tieId, JSON.stringify({ match_id: row!.id, home: st.home.club, away: st.away.club }), actor),
  ]);
  return { ok: true, matchId: row!.id };
}

export async function setTieOverride(tieId: number, home: number | null, away: number | null, actor: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE ties SET home_override_club_id = ?, away_override_club_id = ? WHERE id = ?`).bind(home, away, tieId),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('tie', ?, 'override', ?, ?)`).bind(tieId, JSON.stringify({ home, away }), actor),
  ]);
}

/** Desvincula el partido de una llave (si se borró el partido o se creó mal). */
export async function unlinkTieMatch(tieId: number, actor: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE ties SET match_id = NULL WHERE id = ?`).bind(tieId),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ('tie', ?, 'unlink_match', ?)`).bind(tieId, actor),
  ]);
}

export async function setPositionOverride(tableSlug: string, rank: number, clubId: number | null, reason: string, actor: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT id, position_overrides FROM standing_tables WHERE slug = ?`).bind(tableSlug).first<{ id: number; position_overrides: string }>();
  if (!row) return;
  const o = parseJson<Record<string, number>>(row.position_overrides, {});
  if (clubId) o[String(rank)] = clubId; else delete o[String(rank)];
  await env.DB.batch([
    env.DB.prepare(`UPDATE standing_tables SET position_overrides = ? WHERE id = ?`).bind(JSON.stringify(o), row.id),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('standing_table', ?, 'position_override', ?, ?)`).bind(row.id, JSON.stringify({ rank, clubId, reason }), actor),
  ]);
}

/** Descensos y cupos OFI a partir de la Tabla Anual (art. 6 y 7). */
export function relegationAndOfi(sc: SeasonContext): { relegated: number[]; ofi: number[]; anualClosed: boolean } {
  const cfg = sc.season.config;
  const anual = cfg.definition ? sc.ctx.tables.get(cfg.definition.anual_table) : null;
  if (!anual) return { relegated: [], ofi: [], anualClosed: false };
  const rows = anual.rows;
  const n = cfg.relegation ?? 2;
  const relegated = rows.slice(Math.max(0, rows.length - n)).map((r) => r.clubId);
  const champion = sc.summary?.seasonChampion.club ?? null;
  const ofi: number[] = [];
  if (champion) ofi.push(champion);
  for (const r of rows) {
    if (ofi.length >= (cfg.ofi_slots ?? 2)) break;
    if (!ofi.includes(r.clubId)) ofi.push(r.clubId);
  }
  return { relegated, ofi, anualClosed: anual.pending === 0 };
}

/** Cierra la temporada: escribe títulos y marca torneos y temporada como terminados. */
export async function closeSeason(seasonId: number, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sc = await loadSeasonContext(seasonId);
  if (!sc || !sc.summary) return { ok: false, error: 'Temporada sin definición configurada' };
  const { aperturaChampion, clausuraChampion, seasonChampion } = sc.summary;
  if (!aperturaChampion.club || !clausuraChampion.club || !seasonChampion.club) return { ok: false, error: 'Faltan definir campeones' };
  const d = sc.season.config.definition!;
  const tournaments = await env.DB.prepare(`SELECT id, slug, name FROM tournaments WHERE season_id = ?`).bind(seasonId).all<{ id: number; slug: string; name: string }>();
  const byTable = (slug: string) => tournaments.results.find((t) => t.slug === slug.replace(/-serie-[ab]$/, ''));
  const apertura = byTable(d.apertura_table);
  const clausura = tournaments.results.find((t) => t.slug.startsWith('clausura'));
  const temporada = tournaments.results.find((t) => t.slug === sc.season.slug);
  const stmts = [
    env.DB.prepare(`DELETE FROM titles WHERE season_id = ? AND manual = 0`).bind(seasonId),
    env.DB.prepare(`INSERT INTO titles (club_id, season_id, tournament_id, label) VALUES (?, ?, ?, ?)`).bind(aperturaChampion.club, seasonId, apertura?.id ?? null, `Campeón ${apertura?.name ?? 'Apertura'}`),
    env.DB.prepare(`INSERT INTO titles (club_id, season_id, tournament_id, label) VALUES (?, ?, ?, ?)`).bind(clausuraChampion.club, seasonId, clausura?.id ?? null, `Campeón ${clausura?.name ?? 'Clausura'}`),
    env.DB.prepare(`INSERT INTO titles (club_id, season_id, tournament_id, label) VALUES (?, ?, ?, ?)`).bind(seasonChampion.club, seasonId, temporada?.id ?? null, `Campeón ${sc.season.name}`),
    env.DB.prepare(`UPDATE tournaments SET status = 'finished' WHERE season_id = ?`).bind(seasonId),
    env.DB.prepare(`UPDATE seasons SET closed_at = datetime('now') WHERE id = ?`).bind(seasonId),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('season', ?, 'close', ?, ?)`).bind(seasonId, JSON.stringify(sc.summary), actor),
  ];
  await env.DB.batch(stmts);
  return { ok: true };
}

export async function reopenSeason(seasonId: number, actor: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM titles WHERE season_id = ? AND manual = 0`).bind(seasonId),
    env.DB.prepare(`UPDATE seasons SET closed_at = NULL WHERE id = ?`).bind(seasonId),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ('season', ?, 'reopen', ?)`).bind(seasonId, actor),
  ]);
}
