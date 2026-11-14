import type { APIRoute } from 'astro';
import { deletePhoto } from '../../../../lib/match-content';
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const photoId = Number(params.photoId);
  if (!Number.isInteger(photoId)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  if (form.get('action') === 'delete') await deletePhoto(photoId, locals.session?.user ?? 'desconocido');
  return redirect(String(form.get('back') ?? '/admin'), 303);
};
