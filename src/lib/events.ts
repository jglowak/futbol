// Eventos del partido (gol, tarjeta, cambio) enlazados a jugadores. Alimentan el feed y los goleadores.
// El marcador NO se toca acá: se maneja aparte con +1/−1 (y más adelante un "recalcular desde eventos").
import { env } from 'cloudflare:workers';
import { ensurePlayerByName } from './players';
import type { EventDbType } from './events-core';

const q = env.DB;

export interface MatchEventRow {
  id: number;
  club_id: number;
  type: EventDbType;
  minute: number | null;
  playerName: string | null;
  playerSlug: string | null;
  relatedName: string | null;
}

export async function listEvents(matchId: number): Promise<MatchEventRow[]> {
  const { results } = await q
    .prepare(
      `SELECT e.id, e.club_id, e.type, e.minute,
              p.full_name AS playerName, p.slug AS playerSlug, r.full_name AS relatedName
       FROM match_events e
       LEFT JOIN players p ON p.id = e.player_id
       LEFT JOIN players r ON r.id = e.related_player_id
       WHERE e.match_id = ?
       ORDER BY (e.minute IS NULL), e.minute, e.id`,
    )
    .bind(matchId)
    .all<MatchEventRow>();
  return results;
}

const VALID: EventDbType[] = ['goal', 'penalty_goal', 'own_goal', 'yellow_card', 'red_card', 'sub'];

export interface AddEventInput {
  type: EventDbType;
  minute: number | null;
  clubId: number;
  playerId?: number | null;
  playerName?: string | null; // si no hay playerId (sin planilla cargada)
  relatedPlayerId?: number | null; // el que sale, en un cambio
  relatedPlayerName?: string | null;
}

export async function addEvent(matchId: number, input: AddEventInput, actor: string): Promise<{ ok: boolean; error?: string }> {
  if (!VALID.includes(input.type)) return { ok: false, error: 'Tipo de evento inválido' };
  const match = await q
    .prepare(`SELECT home_club_id, away_club_id FROM matches WHERE id = ?`)
    .bind(matchId)
    .first<{ home_club_id: number; away_club_id: number }>();
  if (!match) return { ok: false, error: 'Partido no encontrado' };
  if (input.clubId !== match.home_club_id && input.clubId !== match.away_club_id)
    return { ok: false, error: 'El club no juega este partido' };

  let playerId = input.playerId ?? null;
  if (!playerId && input.playerName) playerId = await ensurePlayerByName(input.playerName);
  if (!playerId) return { ok: false, error: 'Falta el jugador' };

  let relatedId = input.relatedPlayerId ?? null;
  if (!relatedId && input.relatedPlayerName) relatedId = await ensurePlayerByName(input.relatedPlayerName);
  if (input.type !== 'sub') relatedId = null; // solo los cambios tienen "el que sale"

  const row = await q
    .prepare(
      `INSERT INTO match_events (match_id, club_id, player_id, related_player_id, type, minute, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(matchId, input.clubId, playerId, relatedId, input.type, input.minute, actor)
    .first<{ id: number }>();
  await q
    .prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('match', ?, 'event_add', ?, ?)`)
    .bind(matchId, JSON.stringify({ eventId: row?.id, type: input.type, minute: input.minute, clubId: input.clubId }), actor)
    .run();
  return { ok: true };
}

export async function deleteEvent(eventId: number, actor: string): Promise<void> {
  const ev = await q.prepare(`SELECT match_id FROM match_events WHERE id = ?`).bind(eventId).first<{ match_id: number }>();
  if (!ev) return;
  await q.batch([
    q.prepare(`DELETE FROM match_events WHERE id = ?`).bind(eventId),
    q.prepare(`INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ('match', ?, 'event_delete', ?)`).bind(ev.match_id, actor),
  ]);
}
