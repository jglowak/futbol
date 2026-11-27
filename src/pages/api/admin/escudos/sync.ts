// Copia a R2 los escudos que faltan: los que todavía apuntan a una URL externa (WordPress)
// y también los que ya apuntan a /media/ pero cuyo archivo no está en R2 (una copia que falló).
// Mientras el WordPress siga en línea, esta es la forma de recuperarlos; después hay que subirlos
// a mano desde la ficha del club.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { copyUrlToMedia, mediaBucket } from '../../../../lib/media';

interface ClubRow {
  id: number;
  slug: string;
  crest_url: string | null;
  crest_source_url: string | null;
}

// Tope por tanda: mantiene el pedido corto (en el plan gratuito de Workers son 50 pedidos salientes).
const MAX_POR_TANDA = 40;

export const POST: APIRoute = async ({ request, redirect }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const bucket = mediaBucket();
  if (!bucket) return redirect('/admin?escudos=sin-r2', 303);

  const { results } = await env.DB.prepare(
    `SELECT id, slug, crest_url, crest_source_url FROM clubs
     WHERE crest_url LIKE 'http%'
        OR (crest_url LIKE '/media/%' AND crest_source_url IS NOT NULL AND crest_source_url <> '')
     ORDER BY id`,
  ).all<ClubRow>();

  // Qué falta de verdad: lo externo siempre, y lo que apunta a R2 solo si el archivo no está.
  const pendientes: ClubRow[] = [];
  await Promise.all(
    results.map(async (c) => {
      const url = c.crest_url ?? '';
      if (url.startsWith('http')) {
        pendientes.push(c);
        return;
      }
      if (!(await bucket.head(url.slice('/media/'.length)))) pendientes.push(c);
    }),
  );
  pendientes.sort((a, b) => a.id - b.id);

  const tanda = pendientes.slice(0, MAX_POR_TANDA);
  let ok = 0;
  const failed: string[] = [];
  for (const c of tanda) {
    const source = c.crest_url?.startsWith('http') ? c.crest_url : c.crest_source_url;
    if (!source) continue;
    try {
      const path = await copyUrlToMedia(source, `escudos/${c.slug}`);
      await env.DB.prepare(
        `UPDATE clubs SET crest_source_url = COALESCE(crest_source_url, ?), crest_url = ? WHERE id = ?`,
      )
        .bind(source, path, c.id)
        .run();
      ok++;
    } catch (e) {
      failed.push(`${c.slug}: ${(e as Error).message}`);
    }
  }
  const faltan = pendientes.length - tanda.length;

  await env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('clubs', 0, 'crests_sync', ?, ?)`)
    .bind(JSON.stringify({ ok, faltan, failed }), 'admin')
    .run();

  const partes = [`${ok} copiados`];
  if (failed.length) partes.push(`${failed.length} con error`);
  if (faltan) partes.push(`faltan ${faltan}: tocá otra vez`);
  if (!ok && !failed.length && !faltan) partes.length = 0, partes.push('ya estaban todos');
  return redirect(`/admin?escudos=${encodeURIComponent(partes.join(', '))}`, 303);
};
