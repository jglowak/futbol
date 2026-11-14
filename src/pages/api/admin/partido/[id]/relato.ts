import type { APIRoute } from 'astro';
import { addPost } from '../../../../../lib/match-content';
import { getMatchState } from '../../../../../lib/admin';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const rawMin = String(form.get('minute') ?? '').trim();
  let minute: number | null = rawMin === '' ? null : Number(rawMin);
  if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute > 130)) minute = null;
  if (minute === null && form.get('use_current_minute')) minute = (await getMatchState(id))?.minute ?? null;
  await addPost(id, { minute, kind: String(form.get('kind') ?? 'text'), body: String(form.get('body') ?? '') }, locals.session?.user ?? 'desconocido');
  return redirect(`/admin/partido/${id}#relato`, 303);
};
