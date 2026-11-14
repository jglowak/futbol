import type { APIRoute } from 'astro';
import { createMatch, validateMatchInput } from '../../../../lib/fixture-admin';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const tid = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const v = validateMatchInput(form);
  if (!v.ok) return redirect(`/admin/torneos/${tid}?error=${encodeURIComponent(v.error)}#nuevo`, 303);
  const id = await createMatch(v.data, locals.session?.user ?? 'desconocido');
  return redirect(`/admin/torneos/${tid}?ok=creado-${id}`, 303);
};
