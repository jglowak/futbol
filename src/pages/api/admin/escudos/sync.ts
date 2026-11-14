// Copia a R2 los escudos que todavía apuntan a una URL externa (WordPress).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { copyUrlToMedia, mediaBucket } from '../../../../lib/media';

export const POST: APIRoute = async ({ request, redirect }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  if (!mediaBucket()) return redirect('/admin?escudos=sin-r2', 303);

  const { results } = await env.DB.prepare(
    `SELECT id, slug, crest_url FROM clubs WHERE crest_url LIKE 'http%' ORDER BY id`,
  ).all<{ id: number; slug: string; crest_url: string }>();

  let ok = 0;
  const failed: string[] = [];
  for (const c of results) {
    try {
      const path = await copyUrlToMedia(c.crest_url, `escudos/${c.slug}`);
      await env.DB.prepare(`UPDATE clubs SET crest_source_url = crest_url, crest_url = ? WHERE id = ?`).bind(path, c.id).run();
      ok++;
    } catch (e) {
      failed.push(`${c.slug}: ${(e as Error).message}`);
    }
  }
  await env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('clubs', 0, 'crests_sync', ?, ?)`)
    .bind(JSON.stringify({ ok, failed }), 'admin')
    .run();
  return redirect(`/admin?escudos=ok:${ok},fallidos:${failed.length}`, 303);
};
