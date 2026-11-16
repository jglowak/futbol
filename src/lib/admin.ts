// Operaciones del panel sobre partidos, siempre con historial (audit_log)
// para poder deshacer cualquier cambio.
import { env } from 'cloudflare:workers';
import type { MatchRow } from './db';

export type MatchState = {
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  minute: number | null;
  home_pens: number | null;
  away_pens: number | null;
  finished_at: string | null;
};

export type Action =
  | { type: 'goal'; side: 'home' | 'away'; delta: 1 | -1 }
  | { type: 'status'; status: 'scheduled' | 'live' | 'finished' | 'postponed' }
  | { type: 'minute'; minute: number | null }
  | { type: 'pens'; home: number | null; away: number | null }
  | { type: 'undo' };

const STATE_SQL = `SELECT status, home_goals, away_goals, minute, home_pens, away_pens, finished_at FROM matches WHERE id = ?`;

export async function getMatchState(id: number): Promise<MatchState | null> {
  return env.DB.prepare(STATE_SQL).bind(id).first<MatchState>();
}

function applyAction(before: MatchState, action: Action): MatchState {
  const s: MatchState = { ...before };
  switch (action.type) {
    case 'goal': {
      const key = action.side === 'home' ? 'home_goals' : 'away_goals';
      // Al cargar el primer gol de un partido programado, pasa a "en vivo".
      if (s.status === 'scheduled' || s.status === 'postponed') s.status = 'live';
      if (s.status === 'live') s.finished_at = null;
      s.home_goals ??= 0;
      s.away_goals ??= 0;
      s[key] = Math.max(0, (s[key] ?? 0) + action.delta);
      break;
    }
    case 'status':
      s.status = action.status;
      if (action.status === 'live' || action.status === 'finished') {
        s.home_goals ??= 0;
        s.away_goals ??= 0;
      }
      if (action.status === 'scheduled' || action.status === 'postponed') {
        s.home_goals = null;
        s.away_goals = null;
        s.minute = null;
        s.home_pens = null;
        s.away_pens = null;
      }
      if (action.status === 'finished') {
        s.minute = null;
        s.finished_at = new Date().toISOString();
      } else {
        s.finished_at = null;
      }
      break;
    case 'pens':
      s.home_pens = action.home;
      s.away_pens = action.away;
      break;
    case 'minute':
      s.minute = action.minute;
      break;
    case 'undo':
      break;
  }
  return s;
}

async function writeState(id: number, before: MatchState, after: MatchState, action: string, actor: string, extra?: object) {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE matches SET status = ?, home_goals = ?, away_goals = ?, minute = ?, home_pens = ?, away_pens = ?, finished_at = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(after.status, after.home_goals, after.away_goals, after.minute, after.home_pens, after.away_pens, after.finished_at, id),
    env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('match', ?, ?, ?, ?)`).bind(
      id,
      action,
      JSON.stringify({ before, after, ...extra }),
      actor,
    ),
  ]);
}

export async function performAction(id: number, action: Action, actor: string): Promise<MatchState | null> {
  const before = await getMatchState(id);
  if (!before) return null;

  if (action.type === 'undo') {
    const entry = await lastUndoableEntry(id);
    if (!entry) return before;
    const restored = entry.payload.before;
    await writeState(id, before, restored, 'undo', actor, { undoes: entry.id });
    return restored;
  }

  const after = applyAction(before, action);
  await writeState(id, before, after, action.type, actor, { action });
  return after;
}

type AuditEntry = { id: number; action: string; payload: { before: MatchState; after: MatchState; undoes?: number }; actor: string | null; at: string };

export async function matchHistory(id: number, limit = 30): Promise<AuditEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, action, payload, actor, at FROM audit_log WHERE entity = 'match' AND entity_id = ? ORDER BY id DESC LIMIT ?`,
  )
    .bind(id, limit)
    .all<{ id: number; action: string; payload: string; actor: string | null; at: string }>();
  return results.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

const UNDOABLE = new Set(['goal', 'status', 'minute', 'pens']);

/** Último cambio de marcador/estado que todavía no fue deshecho. */
export async function lastUndoableEntry(id: number): Promise<AuditEntry | null> {
  const history = await matchHistory(id, 100);
  const undone = new Set<number>();
  for (const e of history) {
    if (e.action === 'undo') {
      if (e.payload.undoes) undone.add(e.payload.undoes);
      undone.add(e.id); // un undo tampoco se "re-deshace" (eso sería rehacer)
      continue;
    }
    // Las entradas de alta/edición/borrado del partido no se deshacen desde acá.
    if (!UNDOABLE.has(e.action) || !e.payload?.before || !('status' in e.payload.before)) continue;
    if (!undone.has(e.id)) return e;
  }
  return null;
}

// --- Listados para el panel ---

const ADMIN_MATCH_SELECT = `
  SELECT m.id, m.slug, m.round, m.group_name, m.kickoff_at, m.venue, m.status, m.finished_at,
         m.home_goals, m.away_goals, m.home_pens, m.away_pens, m.minute,
         h.id AS home_id, h.name AS home_name, h.short_name AS home_short, h.slug AS home_slug, h.crest_url AS home_crest,
         a.id AS away_id, a.name AS away_name, a.short_name AS away_short, a.slug AS away_slug, a.crest_url AS away_crest,
         t.name AS tournament_name, t.slug AS tournament_slug
  FROM matches m
  JOIN clubs h ON h.id = m.home_club_id
  JOIN clubs a ON a.id = m.away_club_id
  JOIN stages s ON s.id = m.stage_id
  JOIN tournaments t ON t.id = s.tournament_id
`;

export interface AdminLists {
  live: MatchRow[];
  today: MatchRow[];
  upcoming: MatchRow[];
  recent: MatchRow[];
}

/** Partidos agrupados para la portada del panel. "Hoy" se calcula en hora de Uruguay. */
export async function adminLists(): Promise<AdminLists> {
  const now = new Date();
  const uy = new Date(now.getTime() - 3 * 3600_000); // UTC-3, sin horario de verano
  const dayStart = new Date(Date.UTC(uy.getUTCFullYear(), uy.getUTCMonth(), uy.getUTCDate(), 3)).toISOString();
  const dayEnd = new Date(Date.UTC(uy.getUTCFullYear(), uy.getUTCMonth(), uy.getUTCDate() + 1, 3)).toISOString();

  const [live, today, upcoming, recent] = await Promise.all([
    env.DB.prepare(`${ADMIN_MATCH_SELECT} WHERE m.status = 'live' AND COALESCE(t.source,'') <> 'anwp' ORDER BY m.kickoff_at`).all<MatchRow>(),
    env.DB.prepare(
      `${ADMIN_MATCH_SELECT} WHERE m.status <> 'live' AND COALESCE(t.source,'') <> 'anwp' AND m.kickoff_at >= ? AND m.kickoff_at < ? ORDER BY m.kickoff_at`,
    )
      .bind(dayStart, dayEnd)
      .all<MatchRow>(),
    // Próximos: primero los que tienen fecha futura, después los programados sin fecha ("A confirmar").
    env.DB.prepare(
      `${ADMIN_MATCH_SELECT} WHERE m.status IN ('scheduled','postponed') AND COALESCE(t.source,'') <> 'anwp'
         AND (m.kickoff_at >= ? OR m.kickoff_at IS NULL)
       ORDER BY (m.kickoff_at IS NULL), m.kickoff_at, m.round, m.id LIMIT 12`,
    )
      .bind(dayEnd)
      .all<MatchRow>(),
    // Finalizados que no son de hoy (los de hoy ya aparecen en "Hoy"), ordenados por fecha del partido.
    env.DB.prepare(`${ADMIN_MATCH_SELECT} WHERE m.status = 'finished' AND COALESCE(t.source,'') <> 'anwp' AND NOT (m.kickoff_at >= ? AND m.kickoff_at < ?) ORDER BY COALESCE(m.kickoff_at, m.finished_at) DESC, m.finished_at DESC LIMIT 12`)
      .bind(dayStart, dayEnd)
      .all<MatchRow>(),
  ]);
  return { live: live.results, today: today.results, upcoming: upcoming.results, recent: recent.results };
}

export async function adminMatch(id: number): Promise<MatchRow | null> {
  return env.DB.prepare(`${ADMIN_MATCH_SELECT} WHERE m.id = ?`).bind(id).first<MatchRow>();
}
