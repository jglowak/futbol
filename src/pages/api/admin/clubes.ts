import type { APIRoute } from 'astro';
import { createClub } from '../../../lib/templates';
import { copyUrlToMedia, mediaBucket } from '../../../lib/media';

export function parseClubForm(form: FormData) {
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  const short = String(form.get('short_name') ?? '').trim().slice(0, 40) || null;
  const city = String(form.get('city') ?? '').trim().slice(0, 80) || null;
  const fy = Number(form.get('founded_year'));
  const founded_year = Number.isInteger(fy) && fy > 1850 && fy < 2100 ? fy : null;
  const crest_url = String(form.get('crest_url') ?? '').trim().slice(0, 500) || null;
  return { name, short_name: short, city, founded_year, crest_url };
}

/** Escudo: archivo subido (ya reducido en el navegador) o URL externa copiada a R2. */
export async function resolveCrest(form: FormData, slugBase: string, current: string | null): Promise<string | null> {
  const bucket = mediaBucket();
  const file = form.get('crest_file');
  if (file instanceof File && file.size > 0 && bucket) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('El escudo debe ser PNG, JPG, WEBP, GIF o SVG de hasta 2 MB');
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[file.type]!;
    const key = `escudos/${slugBase}-${Date.now().toString(36)}.${ext}`;
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    return `/media/${key}`;
  }
  const url = String(form.get('crest_url') ?? '').trim();
  if (url && url !== current && /^https?:\/\//.test(url) && bucket) {
    try { return await copyUrlToMedia(url, `escudos/${slugBase}-${Date.now().toString(36)}`); } catch { return url; }
  }
  return url || current;
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const form = await request.formData();
  const data = parseClubForm(form);
  if (!data.name) return redirect(`/admin/clubes?error=${encodeURIComponent('Falta el nombre')}`, 303);
  try {
    data.crest_url = await resolveCrest(form, data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), null);
  } catch (e) { return redirect(`/admin/clubes?error=${encodeURIComponent((e as Error).message)}`, 303); }
  const id = await createClub(data, locals.session?.user ?? 'desconocido');
  return redirect(`/admin/clubes/${id}?ok=1`, 303);
};
