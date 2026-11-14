import type { APIRoute } from 'astro';
import { deletePost } from '../../../../lib/match-content';
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const postId = Number(params.postId);
  if (!Number.isInteger(postId)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  if (form.get('action') === 'delete') await deletePost(postId, locals.session?.user ?? 'desconocido');
  return redirect(String(form.get('back') ?? '/admin'), 303);
};
