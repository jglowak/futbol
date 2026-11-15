import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createTieMatch, setTieOverride, unlinkTieMatch } from '../../../../lib/phases';
import { localToUtc } from '../../../../lib/fixture-admin';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const tieId = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const tie = await env.DB.prepare(`SELECT s.tournament_id FROM ties t JOIN stages s ON s.id = t.stage_id WHERE t.id = ?`).bind(tieId).first<{ tournament_id: number }>();
  if (!tie) return new Response('Llave no encontrada', { status: 404 });
  const back = `/admin/torneos/${tie.tournament_id}`;
  const form = await request.formData();
  const actor = locals.session?.user ?? 'desconocido';
  const action = String(form.get('action') ?? '');

  if (action === 'create') {
    const local = String(form.get('kickoff_local') ?? '').trim();
    const kickoff_at = local ? localToUtc(local) : null;
    if (local && !kickoff_at) return redirect(`${back}?error=${encodeURIComponent('Fecha y hora inválidas')}#llaves`, 303);
    const r = await createTieMatch(tieId, { kickoff_at, venue: String(form.get('venue') ?? '').trim() || null }, actor);
    return redirect(r.ok ? `/admin/partido/${r.matchId}/editar?ok=1` : `${back}?error=${encodeURIComponent(r.error)}#llaves`, 303);
  }
  if (action === 'override') {
    const n = (k: string) => { const v = Number(form.get(k)); return Number.isInteger(v) && v > 0 ? v : null; };
    await setTieOverride(tieId, n('home_club_id'), n('away_club_id'), actor);
    return redirect(`${back}?ok=llave#llaves`, 303);
  }
  if (action === 'unlink') {
    await unlinkTieMatch(tieId, actor);
    return redirect(`${back}?ok=llave#llaves`, 303);
  }
  return new Response('Acción inválida', { status: 400 });
};
