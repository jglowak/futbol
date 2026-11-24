// Guardado de jugadores, plantel (squad) y alineación (lineup) a partir de una planilla revisada.
// La capa pura (planilla-core) decide qué crear y qué enlazar; acá se escribe en D1 con historial.
import { env } from 'cloudflare:workers';
import { slugify } from './slug';
import { nameKey, resolvePlayers, type ExistingPlayer, type PlanillaPlayer } from './planilla-core';

const q = env.DB;

async function uniquePlayerSlug(base: string): Promise<string> {
  const start = base || 'jugador';
  let slug = start;
  for (let i = 2; i < 1000; i++) {
    const row = await q.prepare(`SELECT 1 AS x FROM players WHERE slug = ?`).bind(slug).first();
    if (!row) return slug;
    slug = `${start}-${i}`;
  }
  return `${start}-${Date.now().toString(36)}`;
}

/** Datos del partido necesarios para validar y ubicar la alineación. */
interface MatchForLineup {
  id: number;
  home_club_id: number;
  away_club_id: number;
  season_id: number;
}

async function matchForLineup(matchId: number): Promise<MatchForLineup | null> {
  return q
    .prepare(
      `SELECT m.id, m.home_club_id, m.away_club_id, t.season_id
       FROM matches m JOIN stages s ON s.id = m.stage_id JOIN tournaments t ON t.id = s.tournament_id
       WHERE m.id = ?`,
    )
    .bind(matchId)
    .first<MatchForLineup>();
}

/** Busca jugadores existentes por ficha y por nombre, para decidir enlazar vs crear. */
async function lookupExisting(players: PlanillaPlayer[]): Promise<{ byFicha: Map<string, ExistingPlayer>; byName: Map<string, ExistingPlayer> }> {
  const byFicha = new Map<string, ExistingPlayer>();
  const byName = new Map<string, ExistingPlayer>();
  const fichas = [...new Set(players.map((p) => p.fichaOficial).filter((x): x is string => !!x))];
  if (fichas.length) {
    const { results } = await q
      .prepare(`SELECT id, full_name, ficha_oficial FROM players WHERE ficha_oficial IN (${fichas.map(() => '?').join(',')})`)
      .bind(...fichas)
      .all<{ id: number; full_name: string; ficha_oficial: string }>();
    for (const r of results) byFicha.set(r.ficha_oficial, { id: r.id, fullName: r.full_name });
  }
  // Para provisorios: traer todos y comparar por nombre normalizado (el plantel total es chico).
  const needName = players.some((p) => !p.fichaOficial);
  if (needName) {
    const { results } = await q.prepare(`SELECT id, full_name FROM players`).all<{ id: number; full_name: string }>();
    for (const r of results) byName.set(nameKey(r.full_name), { id: r.id, fullName: r.full_name });
  }
  return { byFicha, byName };
}

export interface SavePlanillaResult {
  ok: boolean;
  error?: string;
  created?: number;
  linked?: number;
  total?: number;
}

/**
 * Guarda la alineación de un club en un partido: crea los jugadores nuevos, actualiza el plantel
 * de la temporada y reemplaza la alineación de ese club en ese partido. Todo queda en audit_log.
 */
export async function savePlanillaLineup(
  input: { matchId: number; clubId: number; players: PlanillaPlayer[] },
  actor: string,
): Promise<SavePlanillaResult> {
  const match = await matchForLineup(input.matchId);
  if (!match) return { ok: false, error: 'Partido no encontrado' };
  if (input.clubId !== match.home_club_id && input.clubId !== match.away_club_id)
    return { ok: false, error: 'El club no juega este partido' };
  const players = input.players.filter((p) => p.fullName.trim());
  if (!players.length) return { ok: false, error: 'La alineación está vacía' };

  const lookup = await lookupExisting(players);
  const resolved = resolvePlayers(players, lookup);

  // Crear los jugadores nuevos (uno por uno, porque necesitamos el id que devuelve cada INSERT).
  let created = 0;
  const idByRow: (number | null)[] = resolved.map((r) => r.playerId);
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (r.action === 'create') {
      const slug = await uniquePlayerSlug(slugify(r.fullName));
      const row = await q
        .prepare(`INSERT INTO players (slug, full_name, ficha_oficial) VALUES (?, ?, ?) RETURNING id`)
        .bind(slug, r.fullName, r.fichaOficial)
        .first<{ id: number }>();
      idByRow[i] = row!.id;
      created++;
    }
  }

  // Plantel + alineación en una sola transacción.
  const stmts = [
    q.prepare(`DELETE FROM lineups WHERE match_id = ? AND club_id = ?`).bind(input.matchId, input.clubId),
  ];
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    const pid = idByRow[i]!;
    stmts.push(
      q
        .prepare(
          `INSERT INTO squads (season_id, club_id, player_id, shirt_number) VALUES (?, ?, ?, ?)
           ON CONFLICT(season_id, club_id, player_id) DO UPDATE SET shirt_number = COALESCE(excluded.shirt_number, squads.shirt_number)`,
        )
        .bind(match.season_id, input.clubId, pid, r.shirtNumber),
    );
    stmts.push(
      q
        .prepare(
          `INSERT INTO lineups (match_id, club_id, player_id, shirt_number, is_starter, is_captain, is_goalkeeper)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(input.matchId, input.clubId, pid, r.shirtNumber, r.isStarter ? 1 : 0, r.isCaptain ? 1 : 0, r.isGoalkeeper ? 1 : 0),
    );
  }
  stmts.push(
    q
      .prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('match', ?, 'lineup_import', ?, ?)`)
      .bind(input.matchId, JSON.stringify({ clubId: input.clubId, created, total: resolved.length }), actor),
  );
  await q.batch(stmts);

  return { ok: true, created, linked: resolved.length - created, total: resolved.length };
}

/** Busca un jugador por nombre (normalizado) o lo crea. Para cargar eventos sin planilla previa. */
export async function ensurePlayerByName(fullName: string): Promise<number | null> {
  const name = fullName.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) return null;
  const key = nameKey(name);
  const { results } = await q.prepare(`SELECT id, full_name FROM players`).all<{ id: number; full_name: string }>();
  const hit = results.find((r) => nameKey(r.full_name) === key);
  if (hit) return hit.id;
  const slug = await uniquePlayerSlug(slugify(name));
  const row = await q.prepare(`INSERT INTO players (slug, full_name) VALUES (?, ?) RETURNING id`).bind(slug, name).first<{ id: number }>();
  return row?.id ?? null;
}

/** Jugadores de la alineación de un club (para los desplegables de eventos). */
export async function lineupPlayers(matchId: number, clubId: number): Promise<{ player_id: number; full_name: string; shirt_number: number | null }[]> {
  const { results } = await q
    .prepare(
      `SELECT l.player_id, p.full_name, l.shirt_number FROM lineups l JOIN players p ON p.id = l.player_id
       WHERE l.match_id = ? AND l.club_id = ? ORDER BY l.is_starter DESC, l.shirt_number`,
    )
    .bind(matchId, clubId)
    .all<{ player_id: number; full_name: string; shirt_number: number | null }>();
  return results;
}

/** Alineación guardada de un partido (para mostrar en el panel y en la página pública). */
export interface LineupRow {
  club_id: number;
  player_id: number;
  full_name: string;
  slug: string;
  shirt_number: number | null;
  is_starter: number;
  is_captain: number;
  is_goalkeeper: number;
}

export async function getLineup(matchId: number): Promise<LineupRow[]> {
  const { results } = await q
    .prepare(
      `SELECT l.club_id, l.player_id, p.full_name, p.slug, l.shirt_number, l.is_starter, l.is_captain, l.is_goalkeeper
       FROM lineups l JOIN players p ON p.id = l.player_id
       WHERE l.match_id = ?
       ORDER BY l.club_id, l.is_starter DESC, l.shirt_number`,
    )
    .bind(matchId)
    .all<LineupRow>();
  return results;
}
