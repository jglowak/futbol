import type { APIRoute } from 'astro';
import { adminMatch } from '../../../../../lib/admin';
import { addEvent } from '../../../../../lib/events';
import { dbTypeFromUi } from '../../../../../lib/events-core';

// Alta de un evento (gol, tarjeta, cambio) desde el panel.
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });

  const match = await adminMatch(id);
  if (!match) return new Response('Partido no encontrado', { status: 404 });

  const form = await request.formData();
  const back = `/admin/partido/${id}#eventos`;
  const fail = (msg: string) => redirect(`${back}?evento=${encodeURIComponent(msg)}`, 303);

  const type = dbTypeFromUi(String(form.get('tipo') ?? ''));
  if (!type) return fail('Elegí el tipo de evento.');

  const rawMin = String(form.get('minute') ?? '').trim();
  let minute: number | null = rawMin === '' ? null : Number(rawMin);
  if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute > 130)) minute = null;

  // Jugador: del desplegable ("clubId:playerId") o escrito a mano (nombre + equipo).
  const player = parseRef(form.get('player'));
  let clubId: number | null = player?.clubId ?? null;
  let playerId: number | null = player?.playerId ?? null;
  let playerName: string | null = null;
  if (!playerId) {
    playerName = String(form.get('player_name') ?? '').trim() || null;
    clubId = String(form.get('club') ?? '') === 'away' ? match.away_id : match.home_id;
  }
  if (!playerId && !playerName) return fail('Indicá el jugador.');

  // El que sale (solo en cambios).
  const out = parseRef(form.get('out'));
  const relatedPlayerId = out?.playerId ?? null;
  const relatedPlayerName = relatedPlayerId ? null : String(form.get('out_name') ?? '').trim() || null;

  const res = await addEvent(
    id,
    { type, minute, clubId: clubId!, playerId, playerName, relatedPlayerId, relatedPlayerName },
    locals.session?.user ?? 'desconocido',
  );
  if (!res.ok) return fail(res.error ?? 'No se pudo guardar.');
  return redirect(back, 303);
};

/** "clubId:playerId" → { clubId, playerId }; vacío → null. */
function parseRef(v: FormDataEntryValue | null): { clubId: number; playerId: number } | null {
  const s = String(v ?? '');
  const m = s.match(/^(\d+):(\d+)$/);
  return m ? { clubId: Number(m[1]), playerId: Number(m[2]) } : null;
}
