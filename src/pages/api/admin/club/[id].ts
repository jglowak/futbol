import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateClub } from '../../../../lib/templates';
import { parseClubForm, resolveCrest } from '../clubes';

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const club = await env.DB.prepare(`SELECT slug, crest_url FROM clubs WHERE id = ?`).bind(id).first<{ slug: string; crest_url: string | null }>();
  if (!club) return new Response('Club no encontrado', { status: 404 });
  const form = await request.formData();
  const data = parseClubForm(form);
  if (!data.name) return redirect(`/admin/clubes/${id}?error=${encodeURIComponent('Falta el nombre')}`, 303);
  try { data.crest_url = await resolveCrest(form, club.slug, club.crest_url); } catch (e) { return redirect(`/admin/clubes/${id}?error=${encodeURIComponent((e as Error).message)}`, 303); }
  await updateClub(id, data, locals.session?.user ?? 'desconocido');
  return redirect(`/admin/clubes/${id}?ok=1`, 303);
};
