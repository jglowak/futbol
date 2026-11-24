import type { APIRoute } from 'astro';
import { deleteEvent } from '../../../../lib/events';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const eventId = Number(params.eventId);
  if (!Number.isInteger(eventId)) return new Response('ID inválido', { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  if (form.get('action') === 'delete') await deleteEvent(eventId, locals.session?.user ?? 'desconocido');
  return redirect(String(form.get('back') ?? '/admin'), 303);
};
