import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { generateFixture } from '../../../../lib/fixture-admin';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const stageId = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const stage = await env.DB.prepare(`SELECT tournament_id FROM stages WHERE id = ?`).bind(stageId).first<{ tournament_id: number }>();
  if (!stage) return new Response('Etapa no encontrada', { status: 404 });
  const form = await request.formData();
  if (form.get('action') !== 'generate') return new Response('Acción inválida', { status: 400 });
  const legs = form.get('legs') === '2' ? 2 : 1;
  const r = await generateFixture(stageId, legs, locals.session?.user ?? 'desconocido');
  const q = r.ok ? `ok=fixture-${r.created}` : `error=${encodeURIComponent(r.error)}`;
  return redirect(`/admin/torneos/${stage.tournament_id}?${q}`, 303);
};
