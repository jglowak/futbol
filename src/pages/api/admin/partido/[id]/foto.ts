import type { APIRoute } from 'astro';
import { addPhoto } from '../../../../../lib/match-content';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) return redirect(`/admin/partido/${id}?foto=vacia#fotos`, 303);
  const num = (k: string) => { const n = Number(form.get(k)); return Number.isInteger(n) && n > 0 ? n : null; };
  const caption = String(form.get('caption') ?? '').trim().slice(0, 300) || null;
  const r = await addPhoto(id, file, { caption, width: num('width'), height: num('height') }, locals.session?.user ?? 'desconocido');
  if (request.headers.get('accept')?.includes('application/json')) {
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400, headers: { 'content-type': 'application/json' } });
  }
  return redirect(`/admin/partido/${id}?foto=${r.ok ? 'ok' : encodeURIComponent(r.error)}#fotos`, 303);
};
