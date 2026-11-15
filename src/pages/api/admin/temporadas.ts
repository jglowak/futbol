import type { APIRoute } from 'astro';
import { createSeason } from '../../../lib/templates';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const year = Number(form.get('year'));
  const name = String(form.get('name') ?? '').trim().slice(0, 80) || `Temporada ${year}`;
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return redirect(`/admin/temporadas?error=${encodeURIComponent('Año inválido')}`, 303);
  const n = (k: string, d: number) => { const v = Number(form.get(k)); return Number.isInteger(v) && v >= 0 && v <= 12 ? v : d; };
  const id = await createSeason({ name, year, relegation: n('relegation', 2), ofi_slots: n('ofi_slots', 2) }, locals.session?.user ?? 'desconocido');
  return redirect(`/admin/temporada/${id}?ok=creada`, 303);
};
