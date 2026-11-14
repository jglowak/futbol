import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { deleteMatch, updateMatch, validateMatchInput } from '../../../../../lib/fixture-admin';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const actor = locals.session?.user ?? 'desconocido';
  const t = await env.DB.prepare(`SELECT s.tournament_id FROM matches m JOIN stages s ON s.id = m.stage_id WHERE m.id = ?`).bind(id).first<{ tournament_id: number }>();
  if (!t) return new Response('Partido no encontrado', { status: 404 });

  if (form.get('action') === 'delete') {
    await deleteMatch(id, actor);
    return redirect(`/admin/torneos/${t.tournament_id}?ok=borrado`, 303);
  }
  const v = validateMatchInput(form);
  if (!v.ok) return redirect(`/admin/partido/${id}/editar?error=${encodeURIComponent(v.error)}`, 303);
  await updateMatch(id, v.data, actor);
  return redirect(`/admin/partido/${id}/editar?ok=1`, 303);
};
