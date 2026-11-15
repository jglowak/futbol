import type { APIRoute } from 'astro';
import { setPositionOverride } from '../../../../lib/phases';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const rank = Number(form.get('rank'));
  const clubId = Number(form.get('club_id')) || null;
  const reason = String(form.get('reason') ?? '').trim().slice(0, 200);
  if (!Number.isInteger(rank) || rank < 1) return new Response('Posición inválida', { status: 400 });
  if (clubId && !reason) return redirect(`${String(form.get('back') ?? '/admin')}?error=${encodeURIComponent('Indicá el motivo del desempate')}#llaves`, 303);
  await setPositionOverride(params.slug!, rank, clubId, reason, locals.session?.user ?? 'desconocido');
  return redirect(`${String(form.get('back') ?? '/admin')}?ok=desempate#llaves`, 303);
};
