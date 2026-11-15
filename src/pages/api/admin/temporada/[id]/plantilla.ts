import type { APIRoute } from 'astro';
import { createCup, createLeague, createLffSeason } from '../../../../../lib/templates';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const actor = locals.session?.user ?? 'desconocido';
  const clubIds = form.getAll('club_id').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const name = String(form.get('name') ?? '').trim().slice(0, 80);
  const category = String(form.get('category') ?? 'Absoluta').trim().slice(0, 40);
  const back = `/admin/temporada/${id}`;
  const template = String(form.get('template') ?? '');
  let r: { ok: true } | { ok: true; tournamentId: number } | { ok: false; error: string };
  if (template === 'lff') r = await createLffSeason(id, clubIds, actor);
  else if (template === 'copa') r = name ? await createCup(id, { name, category, clubIds }, actor) : { ok: false, error: 'Falta el nombre de la copa' };
  else if (template === 'liga') r = name ? await createLeague(id, { name, category, clubIds, legs: form.get('legs') === '2' ? 2 : 1 }, actor) : { ok: false, error: 'Falta el nombre de la liga' };
  else return new Response('Plantilla desconocida', { status: 400 });
  if (!r.ok) return redirect(`${back}?error=${encodeURIComponent(r.error)}#plantillas`, 303);
  return redirect('tournamentId' in r ? `/admin/torneos/${r.tournamentId}?ok=creado` : `${back}?ok=plantilla`, 303);
};
