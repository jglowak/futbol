// Creación de temporadas y torneos desde plantillas (capa de base de datos).
import { env } from 'cloudflare:workers';
import { resolveTableRank } from './phases-core';
import { loadSeasonContext } from './phases';
import { slugify, matchSlugBase } from './slug';
import { cupTies, lffSeries, ofiSixFixture } from './templates-core';

const q = env.DB;

async function uniqueSlug(table: 'tournaments' | 'seasons' | 'clubs' | 'standing_tables', base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const row = await q.prepare(`SELECT 1 AS x FROM ${table} WHERE slug = ?`).bind(slug).first();
    if (!row) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------- Temporadas ----------
export async function createSeason(data: { name: string; year: number; relegation: number; ofi_slots: number }, actor: string): Promise<number> {
  const slug = await uniqueSlug('seasons', slugify(data.name) || `temporada-${data.year}`);
  const config = JSON.stringify({ relegation: data.relegation, ofi_slots: data.ofi_slots });
  const row = await q.prepare(`INSERT INTO seasons (slug, name, year, config) VALUES (?, ?, ?, ?) RETURNING id`).bind(slug, data.name, data.year, config).first<{ id: number }>();
  await q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('season', ?, 'create', ?, ?)`).bind(row!.id, JSON.stringify(data), actor).run();
  return row!.id;
}

// ---------- Clubes ----------
export interface ClubInput { name: string; short_name: string | null; city: string | null; founded_year: number | null; crest_url: string | null }

export async function createClub(data: ClubInput, actor: string): Promise<number> {
  const slug = await uniqueSlug('clubs', slugify(data.name));
  const row = await q.prepare(`INSERT INTO clubs (slug, name, short_name, city, founded_year, crest_url) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(slug, data.name, data.short_name, data.city, data.founded_year, data.crest_url).first<{ id: number }>();
  await q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('club', ?, 'create', ?, ?)`).bind(row!.id, JSON.stringify(data), actor).run();
  return row!.id;
}

export async function updateClub(id: number, data: Partial<ClubInput>, actor: string): Promise<void> {
  const before = await q.prepare(`SELECT name, short_name, city, founded_year, crest_url FROM clubs WHERE id = ?`).bind(id).first<ClubInput>();
  if (!before) return;
  const after = { ...before, ...data };
  await q.batch([
    q.prepare(`UPDATE clubs SET name = ?, short_name = ?, city = ?, founded_year = ?, crest_url = ? WHERE id = ?`).bind(after.name, after.short_name, after.city, after.founded_year, after.crest_url, id),
    q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('club', ?, 'edit', ?, ?)`).bind(id, JSON.stringify({ before, after }), actor),
  ]);
}

// ---------- Plantilla LFF Apertura/Clausura ----------
const TB = '{"tiebreakers":["goal_difference","goals_for"]}';

/**
 * Crea Apertura (liga de 12), Clausura (series + semifinales + final), la definición de temporada
 * (finales B/C/D) y las cuatro tablas. Las series se arman después, al cerrar el Apertura.
 */
export async function createLffSeason(seasonId: number, clubIds: number[], actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (clubIds.length !== 12) return { ok: false, error: `La plantilla LFF necesita 12 clubes; elegiste ${clubIds.length}` };
  const season = await q.prepare(`SELECT id, slug, name, year, config FROM seasons WHERE id = ?`).bind(seasonId).first<{ id: number; slug: string; name: string; year: number; config: string }>();
  if (!season) return { ok: false, error: 'Temporada no encontrada' };
  const existing = await q.prepare(`SELECT COUNT(*) AS n FROM tournaments WHERE season_id = ?`).bind(seasonId).first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return { ok: false, error: 'La temporada ya tiene torneos' };
  const y = season.year;
  const S = {
    apertura: await uniqueSlug('tournaments', `apertura-${y}`),
    clausura: await uniqueSlug('tournaments', `clausura-${y}`),
    temporada: await uniqueSlug('tournaments', `temporada-${y}`),
  };
  const T = { apertura: `apertura-${y}`, serieA: `clausura-${y}-serie-a`, serieB: `clausura-${y}-serie-b`, anual: `anual-${y}` };
  for (const slug of Object.values(T)) if (await q.prepare(`SELECT 1 AS x FROM standing_tables WHERE slug = ?`).bind(slug).first()) return { ok: false, error: `Ya existe la tabla ${slug}` };

  const ins = async (sql: string, ...args: unknown[]) => (await q.prepare(sql).bind(...args).first<{ id: number }>())!.id;
  const tAp = await ins(`INSERT INTO tournaments (season_id, slug, name, category, template, status) VALUES (?, ?, ?, 'Absoluta', 'apertura_clausura', 'upcoming') RETURNING id`, seasonId, S.apertura, `Apertura ${y}`);
  const tCl = await ins(`INSERT INTO tournaments (season_id, slug, name, category, template, status) VALUES (?, ?, ?, 'Absoluta', 'apertura_clausura', 'upcoming') RETURNING id`, seasonId, S.clausura, `Clausura ${y}`);
  const tTe = await ins(`INSERT INTO tournaments (season_id, slug, name, category, template, status) VALUES (?, ?, ?, 'Absoluta', 'lff_temporada', 'upcoming') RETURNING id`, seasonId, S.temporada, `Definición de la Temporada ${y}`);
  const stAp = await ins(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, 1, 'Fase regular', 'league', '{"legs":1}') RETURNING id`, tAp);
  const stSe = await ins(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, 1, 'Series', 'groups', '{"legs":1,"advance_per_group":2}') RETURNING id`, tCl);
  const stSf = await ins(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, 2, 'Semifinales', 'knockout', '{"legs":1,"extra_time":true,"penalties":true}') RETURNING id`, tCl);
  const stFi = await ins(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, 3, 'Final', 'knockout', '{"legs":1,"extra_time":true,"penalties":true,"neutral":true}') RETURNING id`, tCl);
  const stTe = await ins(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, 1, 'Finales', 'knockout', '{"legs":1,"extra_time":true,"penalties":true,"neutral":true}') RETURNING id`, tTe);
  const tbAp = await ins(`INSERT INTO standing_tables (season_id, slug, name, config) VALUES (?, ?, ?, ?) RETURNING id`, seasonId, T.apertura, `Tabla del Apertura ${y}`, TB);
  const tbA = await ins(`INSERT INTO standing_tables (season_id, slug, name, config) VALUES (?, ?, ?, ?) RETURNING id`, seasonId, T.serieA, `Clausura ${y} · Serie A`, TB);
  const tbB = await ins(`INSERT INTO standing_tables (season_id, slug, name, config) VALUES (?, ?, ?, ?) RETURNING id`, seasonId, T.serieB, `Clausura ${y} · Serie B`, TB);
  const tbAn = await ins(`INSERT INTO standing_tables (season_id, slug, name, config) VALUES (?, ?, ?, ?) RETURNING id`, seasonId, T.anual, `Tabla Anual ${y} (Apertura + Clausura)`, TB);

  const rank = (table: string, r: number) => JSON.stringify({ type: 'table_rank', table, rank: r });
  const win = (tie: string) => JSON.stringify({ type: 'tie_winner', tie });
  const lose = (tie: string) => JSON.stringify({ type: 'tie_loser', tie });
  const C = { sf1: `clausura-${y}-sf1`, sf2: `clausura-${y}-sf2`, final: `clausura-${y}-final`, tf: `temporada-${y}-final`, tfe: `temporada-${y}-final-extra`, tfa: `temporada-${y}-final-anual` };
  const stmts = [
    ...clubIds.map((c) => q.prepare(`INSERT INTO stage_clubs (stage_id, club_id, group_name) VALUES (?, ?, '')`).bind(stAp, c)),
    q.prepare(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (?, ?, '')`).bind(tbAp, stAp),
    q.prepare(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (?, ?, 'Serie A')`).bind(tbA, stSe),
    q.prepare(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (?, ?, 'Serie B')`).bind(tbB, stSe),
    q.prepare(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (?, ?, '')`).bind(tbAn, stAp),
    q.prepare(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (?, ?, '')`).bind(tbAn, stSe),
    q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, neutral) VALUES (?, 1, ?, 'Semifinal 1', ?, ?, 0)`).bind(stSf, C.sf1, rank(T.serieA, 1), rank(T.serieB, 2)),
    q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, neutral) VALUES (?, 2, ?, 'Semifinal 2', ?, ?, 0)`).bind(stSf, C.sf2, rank(T.serieB, 1), rank(T.serieA, 2)),
    q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, neutral) VALUES (?, 1, ?, 'Final del Clausura', ?, ?, 1)`).bind(stFi, C.final, win(C.sf1), win(C.sf2)),
    q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, condition, neutral, note) VALUES (?, 1, ?, 'Final de la Temporada', ?, ?, ?, 1, 'Se juega solo si el campeón del Apertura y el del Clausura son distintos (art. 5 B).')`)
      .bind(stTe, C.tf, rank(T.apertura, 1), win(C.final), JSON.stringify({ type: 'distinct', a: { type: 'table_rank', table: T.apertura, rank: 1 }, b: { type: 'tie_winner', tie: C.final } })),
    q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, condition, neutral, note) VALUES (?, 2, ?, 'Final extra', ?, ?, ?, 1, 'Se juega solo si el perdedor de la Final es el 1° de la Tabla Anual (art. 5 C).')`)
      .bind(stTe, C.tfe, lose(C.tf), win(C.tf), JSON.stringify({ type: 'equals', a: { type: 'tie_loser', tie: C.tf }, b: { type: 'table_rank', table: T.anual, rank: 1 } })),
    q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, condition, neutral, note) VALUES (?, 3, ?, 'Final con el 1° de la Anual', ?, ?, ?, 1, 'Se juega solo si el 1° de la Tabla Anual no es campeón del Apertura ni del Clausura (art. 5 D).')`)
      .bind(stTe, C.tfa, rank(T.anual, 1), win(C.tf), JSON.stringify({ type: 'not_in', ref: { type: 'table_rank', table: T.anual, rank: 1 }, set: [{ type: 'table_rank', table: T.apertura, rank: 1 }, { type: 'tie_winner', tie: C.final }] })),
    q.prepare(`UPDATE seasons SET config = json_set(config, '$.definition', json(?)) WHERE id = ?`).bind(JSON.stringify({ apertura_table: T.apertura, clausura_final: C.final, anual_table: T.anual, final: C.tf, final_extra: C.tfe, final_anual: C.tfa }), seasonId),
    q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('season', ?, 'template_lff', ?, ?)`).bind(seasonId, JSON.stringify({ clubIds }), actor),
  ];
  await q.batch(stmts);
  return { ok: true };
}

/**
 * Arma las series del Clausura a partir de la tabla final del Apertura (art. 4) y genera
 * su fixture con el modelo OFI para seis, invirtiendo las localías del Apertura.
 */
export async function buildLffSeries(clausuraTournamentId: number, actor: string): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const t = await q.prepare(`SELECT id, season_id, slug FROM tournaments WHERE id = ?`).bind(clausuraTournamentId).first<{ id: number; season_id: number; slug: string }>();
  if (!t) return { ok: false, error: 'Torneo no encontrado' };
  const stage = await q.prepare(`SELECT id FROM stages WHERE tournament_id = ? AND kind = 'groups' ORDER BY position LIMIT 1`).bind(t.id).first<{ id: number }>();
  if (!stage) return { ok: false, error: 'El torneo no tiene etapa de series' };
  const has = await q.prepare(`SELECT (SELECT COUNT(*) FROM stage_clubs WHERE stage_id = ?) AS clubs, (SELECT COUNT(*) FROM matches WHERE stage_id = ?) AS matches`).bind(stage.id, stage.id).first<{ clubs: number; matches: number }>();
  if ((has?.clubs ?? 0) > 0 || (has?.matches ?? 0) > 0) return { ok: false, error: 'Las series ya están armadas' };

  const sc = await loadSeasonContext(t.season_id);
  const apTable = sc?.season.config.definition?.apertura_table;
  if (!sc || !apTable) return { ok: false, error: 'La temporada no tiene definición LFF' };
  const order: number[] = [];
  for (let r = 1; r <= 12; r++) {
    const res = resolveTableRank(apTable, r, sc.ctx);
    if (res.club === null) return { ok: false, error: `No se puede armar: ${res.reason}` };
    order.push(res.club);
  }
  let series;
  try { series = lffSeries(order); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // Localías del Apertura entre cada par (para invertirlas)
  const apStage = await q.prepare(`SELECT src.stage_id FROM standing_table_sources src JOIN standing_tables st ON st.id = src.table_id WHERE st.slug = ? LIMIT 1`).bind(apTable).first<{ stage_id: number }>();
  const { results: apMatches } = await q.prepare(`SELECT home_club_id h, away_club_id a FROM matches WHERE stage_id = ?`).bind(apStage!.stage_id).all<{ h: number; a: number }>();
  const homeOf = new Map(apMatches.map((m) => [`${Math.min(m.h, m.a)}-${Math.max(m.h, m.a)}`, m.h]));
  const wasHome = (x: number, y: number) => { const h = homeOf.get(`${Math.min(x, y)}-${Math.max(x, y)}`); return h === undefined ? null : h === x; };
  const { results: names } = await q.prepare(`SELECT id, COALESCE(short_name, name) AS n FROM clubs`).all<{ id: number; n: string }>();
  const nameOf = new Map(names.map((c) => [c.id, c.n]));

  const stmts: D1PreparedStatement[] = [];
  const { results: existing } = await q.prepare(`SELECT slug FROM matches WHERE slug IS NOT NULL`).all<{ slug: string }>();
  const used = new Set(existing.map((r) => r.slug));
  for (const [group, clubs] of Object.entries(series) as ['Serie A' | 'Serie B', number[]][]) {
    for (const c of clubs) stmts.push(q.prepare(`INSERT INTO stage_clubs (stage_id, club_id, group_name) VALUES (?, ?, ?)`).bind(stage.id, c, group));
    for (const m of ofiSixFixture(clubs, wasHome)) {
      // Sin fecha todavía: la URL lleva el torneo para ser única; se recalcula al cargar día y hora.
      const base = `${matchSlugBase(nameOf.get(m.home)!, nameOf.get(m.away)!, null)}-${t.slug}`;
      let slug = base; let i = 2;
      while (used.has(slug)) slug = `${base}-${i++}`;
      used.add(slug);
      stmts.push(q.prepare(`INSERT INTO matches (stage_id, round, group_name, home_club_id, away_club_id, slug) VALUES (?, ?, ?, ?, ?, ?)`).bind(stage.id, `Fecha ${m.round}`, group, m.home, m.away, slug));
    }
  }
  stmts.push(q.prepare(`UPDATE tournaments SET status = 'ongoing' WHERE id = ?`).bind(t.id));
  stmts.push(q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('tournament', ?, 'build_series', ?, ?)`).bind(t.id, JSON.stringify(series), actor));
  await q.batch(stmts);
  return { ok: true, created: 30 };
}

// ---------- Copa eliminatoria ----------
export async function createCup(seasonId: number, data: { name: string; category: string; clubIds: number[] }, actor: string): Promise<{ ok: true; tournamentId: number } | { ok: false; error: string }> {
  let plan;
  try { plan = cupTies(data.clubIds, slugify(data.name)); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const slug = await uniqueSlug('tournaments', slugify(data.name));
  const tid = (await q.prepare(`INSERT INTO tournaments (season_id, slug, name, category, template, status) VALUES (?, ?, ?, ?, 'copa_eliminatoria', 'upcoming') RETURNING id`).bind(seasonId, slug, data.name, data.category || 'Absoluta').first<{ id: number }>())!.id;
  const stageIds: number[] = [];
  for (let i = 0; i < plan.stages.length; i++) {
    const neutral = i === plan.stages.length - 1 ? 1 : 0;
    stageIds.push((await q.prepare(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, ?, ?, 'knockout', ?) RETURNING id`).bind(tid, i + 1, plan.stages[i], JSON.stringify({ legs: 1, extra_time: true, penalties: true, neutral: Boolean(neutral) })).first<{ id: number }>())!.id);
  }
  const stmts = [
    ...data.clubIds.map((c) => q.prepare(`INSERT INTO stage_clubs (stage_id, club_id, group_name) VALUES (?, ?, '')`).bind(stageIds[0], c)),
    ...plan.ties.map((t, i) => q.prepare(`INSERT INTO ties (stage_id, position, code, label, home_ref, away_ref, neutral) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(stageIds[t.stageIndex], i + 1, `${slug}-${t.code.split('-').slice(-2).join('-')}`, t.label,
        JSON.stringify(t.home.type === 'club' ? t.home : { type: 'tie_winner', tie: `${slug}-${t.home.tie.split('-').slice(-2).join('-')}` }),
        JSON.stringify(t.away.type === 'club' ? t.away : { type: 'tie_winner', tie: `${slug}-${t.away.tie.split('-').slice(-2).join('-')}` }),
        t.stageIndex === plan.stages.length - 1 ? 1 : 0)),
    q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('tournament', ?, 'template_cup', ?, ?)`).bind(tid, JSON.stringify(data), actor),
  ];
  await q.batch(stmts);
  return { ok: true, tournamentId: tid };
}

// ---------- Liga simple ----------
export async function createLeague(seasonId: number, data: { name: string; category: string; clubIds: number[]; legs: 1 | 2 }, actor: string): Promise<{ ok: true; tournamentId: number } | { ok: false; error: string }> {
  if (data.clubIds.length < 2) return { ok: false, error: 'Una liga necesita al menos 2 clubes' };
  const slug = await uniqueSlug('tournaments', slugify(data.name));
  const tableSlug = await uniqueSlug('standing_tables', slug);
  const tid = (await q.prepare(`INSERT INTO tournaments (season_id, slug, name, category, template, status) VALUES (?, ?, ?, ?, 'liga', 'upcoming') RETURNING id`).bind(seasonId, slug, data.name, data.category || 'Absoluta').first<{ id: number }>())!.id;
  const sid = (await q.prepare(`INSERT INTO stages (tournament_id, position, name, kind, config) VALUES (?, 1, 'Fase regular', 'league', ?) RETURNING id`).bind(tid, JSON.stringify({ legs: data.legs })).first<{ id: number }>())!.id;
  const tb = (await q.prepare(`INSERT INTO standing_tables (season_id, slug, name, config) VALUES (?, ?, ?, ?) RETURNING id`).bind(seasonId, tableSlug, `Tabla ${data.name}`, TB).first<{ id: number }>())!.id;
  await q.batch([
    ...data.clubIds.map((c) => q.prepare(`INSERT INTO stage_clubs (stage_id, club_id, group_name) VALUES (?, ?, '')`).bind(sid, c)),
    q.prepare(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (?, ?, '')`).bind(tb, sid),
    q.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('tournament', ?, 'template_league', ?, ?)`).bind(tid, JSON.stringify(data), actor),
  ]);
  return { ok: true, tournamentId: tid };
}
