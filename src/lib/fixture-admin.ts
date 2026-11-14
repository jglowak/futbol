// Gestión de fixture desde el panel: alta, edición y baja de partidos, generación de fechas.
import { env } from 'cloudflare:workers';
import { roundRobin } from './fixture';
import { matchSlugBase } from './slug';

export interface StageRow { id: number; tournament_id: number; position: number; name: string; kind: string; config: string }
export interface StageClubRow { stage_id: number; club_id: number; group_name: string; name: string; short_name: string | null; crest_url: string | null }

export async function tournamentWithStages(tournamentId: number) {
  const t = await env.DB.prepare(
    `SELECT t.id, t.slug, t.name, t.category, t.status, t.season_id, s.name AS season_name
     FROM tournaments t JOIN seasons s ON s.id = t.season_id WHERE t.id = ?`,
  ).bind(tournamentId).first<{ id: number; slug: string; name: string; category: string; status: string; season_id: number; season_name: string }>();
  if (!t) return null;
  const [stages, clubs] = await Promise.all([
    env.DB.prepare(`SELECT * FROM stages WHERE tournament_id = ? ORDER BY position`).bind(tournamentId).all<StageRow>(),
    env.DB.prepare(
      `SELECT sc.stage_id, sc.club_id, sc.group_name, c.name, c.short_name, c.crest_url
       FROM stage_clubs sc JOIN clubs c ON c.id = sc.club_id JOIN stages s ON s.id = sc.stage_id
       WHERE s.tournament_id = ? ORDER BY sc.group_name, c.name`,
    ).bind(tournamentId).all<StageClubRow>(),
  ]);
  return { tournament: t, stages: stages.results, clubs: clubs.results };
}

export async function listTournamentsAdmin() {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.slug, t.name, t.category, t.status, s.name AS season_name,
            (SELECT COUNT(*) FROM matches m JOIN stages st ON st.id = m.stage_id WHERE st.tournament_id = t.id) AS matches,
            (SELECT COUNT(*) FROM matches m JOIN stages st ON st.id = m.stage_id WHERE st.tournament_id = t.id AND m.status = 'finished') AS finished
     FROM tournaments t JOIN seasons s ON s.id = t.season_id ORDER BY s.year DESC, t.id DESC`,
  ).all<{ id: number; slug: string; name: string; category: string; status: string; season_name: string; matches: number; finished: number }>();
  return results;
}

/** Hora local de Uruguay (datetime-local) → ISO UTC. */
export function localToUtc(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** ISO UTC → valor para <input type="datetime-local"> en hora de Uruguay. */
export function utcToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const row = await env.DB.prepare(`SELECT id FROM matches WHERE slug = ?`).bind(slug).first<{ id: number }>();
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function clubShort(id: number): Promise<string> {
  const c = await env.DB.prepare(`SELECT COALESCE(short_name, name) AS n FROM clubs WHERE id = ?`).bind(id).first<{ n: string }>();
  return c?.n ?? String(id);
}

export async function computeMatchSlug(homeId: number, awayId: number, kickoffIso: string | null, excludeId?: number): Promise<string> {
  const [h, a] = await Promise.all([clubShort(homeId), clubShort(awayId)]);
  return uniqueSlug(matchSlugBase(h, a, kickoffIso), excludeId);
}

export interface MatchInput {
  stage_id: number;
  group_name: string;
  round: string;
  home_club_id: number;
  away_club_id: number;
  kickoff_at: string | null;
  venue: string | null;
}

export function validateMatchInput(form: FormData): { ok: true; data: MatchInput } | { ok: false; error: string } {
  const stage_id = Number(form.get('stage_id'));
  const home_club_id = Number(form.get('home_club_id'));
  const away_club_id = Number(form.get('away_club_id'));
  if (!Number.isInteger(stage_id) || !Number.isInteger(home_club_id) || !Number.isInteger(away_club_id)) return { ok: false, error: 'Datos incompletos' };
  if (home_club_id === away_club_id) return { ok: false, error: 'El local y el visitante no pueden ser el mismo club' };
  const local = String(form.get('kickoff_local') ?? '').trim();
  const kickoff_at = local ? localToUtc(local) : null;
  if (local && !kickoff_at) return { ok: false, error: 'Fecha y hora inválidas' };
  return {
    ok: true,
    data: {
      stage_id,
      group_name: String(form.get('group_name') ?? '').trim().slice(0, 40),
      round: String(form.get('round') ?? '').trim().slice(0, 40),
      home_club_id,
      away_club_id,
      kickoff_at,
      venue: String(form.get('venue') ?? '').trim().slice(0, 120) || null,
    },
  };
}

export async function createMatch(data: MatchInput, actor: string): Promise<number> {
  const slug = await computeMatchSlug(data.home_club_id, data.away_club_id, data.kickoff_at);
  const row = await env.DB.prepare(
    `INSERT INTO matches (stage_id, round, group_name, home_club_id, away_club_id, kickoff_at, venue, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(data.stage_id, data.round, data.group_name, data.home_club_id, data.away_club_id, data.kickoff_at, data.venue, slug)
    .first<{ id: number }>();
  await env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('match', ?, 'create', ?, ?)`)
    .bind(row!.id, JSON.stringify(data), actor).run();
  return row!.id;
}

export async function updateMatch(id: number, data: MatchInput, actor: string): Promise<void> {
  const before = await env.DB.prepare(`SELECT stage_id, round, group_name, home_club_id, away_club_id, kickoff_at, venue, slug FROM matches WHERE id = ?`).bind(id).first();
  if (!before) return;
  const slug = await computeMatchSlug(data.home_club_id, data.away_club_id, data.kickoff_at, id);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE matches SET stage_id = ?, round = ?, group_name = ?, home_club_id = ?, away_club_id = ?, kickoff_at = ?, venue = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(data.stage_id, data.round, data.group_name, data.home_club_id, data.away_club_id, data.kickoff_at, data.venue, slug, id),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('match', ?, 'edit', ?, ?)`)
      .bind(id, JSON.stringify({ before, after: { ...data, slug } }), actor),
  ]);
}

export async function deleteMatch(id: number, actor: string): Promise<void> {
  const before = await env.DB.prepare(`SELECT * FROM matches WHERE id = ?`).bind(id).first();
  if (!before) return;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM match_events WHERE match_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM lineups WHERE match_id = ?`).bind(id),
    env.DB.prepare(`UPDATE match_posts SET deleted_at = datetime('now') WHERE match_id = ?`).bind(id),
    env.DB.prepare(`UPDATE match_photos SET deleted_at = datetime('now') WHERE match_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM matches WHERE id = ?`).bind(id),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('match', ?, 'delete', ?, ?)`)
      .bind(id, JSON.stringify(before), actor),
  ]);
}

/** Genera todas las fechas de una etapa (por serie si las hay). Solo si la etapa no tiene partidos. */
export async function generateFixture(stageId: number, legs: 1 | 2, actor: string): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const existing = await env.DB.prepare(`SELECT COUNT(*) AS n FROM matches WHERE stage_id = ?`).bind(stageId).first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return { ok: false, error: 'La etapa ya tiene partidos. Borralos antes de generar el fixture.' };
  const { results } = await env.DB.prepare(
    `SELECT sc.club_id, sc.group_name, COALESCE(c.short_name, c.name) AS n FROM stage_clubs sc JOIN clubs c ON c.id = sc.club_id WHERE sc.stage_id = ? ORDER BY sc.group_name, sc.club_id`,
  ).bind(stageId).all<{ club_id: number; group_name: string; n: string }>();
  if (results.length < 2) return { ok: false, error: 'La etapa necesita al menos 2 clubes.' };
  const groups = new Map<string, { club_id: number; n: string }[]>();
  for (const r of results) groups.set(r.group_name, [...(groups.get(r.group_name) ?? []), r]);

  const stmts: D1PreparedStatement[] = [];
  const used = new Set<string>();
  for (const [group, clubs] of groups) {
    const names = new Map(clubs.map((c) => [c.club_id, c.n]));
    for (const p of roundRobin(clubs.map((c) => c.club_id), legs)) {
      let slug = matchSlugBase(names.get(p.home)!, names.get(p.away)!, null);
      let i = 2;
      while (used.has(slug)) slug = `${matchSlugBase(names.get(p.home)!, names.get(p.away)!, null)}-${i++}`;
      used.add(slug);
      stmts.push(
        env.DB.prepare(`INSERT INTO matches (stage_id, round, group_name, home_club_id, away_club_id, slug) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(stageId, `Fecha ${p.round}`, group, p.home, p.away, slug),
      );
    }
  }
  // Los slugs generados sin fecha se vuelven a calcular cuando se carga la fecha y hora.
  stmts.push(env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('stage', ?, 'generate_fixture', ?, ?)`).bind(stageId, JSON.stringify({ legs, created: stmts.length }), actor));
  await env.DB.batch(stmts);
  return { ok: true, created: stmts.length - 1 };
}
