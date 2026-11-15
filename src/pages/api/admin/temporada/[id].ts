import type { APIRoute } from 'astro';
import { closeSeason, reopenSeason } from '../../../../lib/phases';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const actor = locals.session?.user ?? 'desconocido';
  const action = String(form.get('action') ?? '');
  if (action === 'close') {
    const r = await closeSeason(id, actor);
    return redirect(`/admin/temporada/${id}?${r.ok ? 'ok=cerrada' : `error=${encodeURIComponent(r.error)}`}`, 303);
  }
  if (action === 'reopen') {
    await reopenSeason(id, actor);
    return redirect(`/admin/temporada/${id}?ok=reabierta`, 303);
  }
  return new Response('Acción inválida', { status: 400 });
};
