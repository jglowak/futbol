import type { APIRoute } from 'astro';
import { buildLffSeries } from '../../../../../lib/templates';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const r = await buildLffSeries(id, locals.session?.user ?? 'desconocido');
  return redirect(r.ok ? `/admin/torneos/${id}?ok=series-${r.created}` : `/admin/torneos/${id}?error=${encodeURIComponent(r.error)}`, 303);
};
