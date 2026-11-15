// Ejecuta db/import-history.sql (generado por scripts/import-anwp-history.mjs) en la base.
// Es idempotente: se puede correr varias veces sin duplicar.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import sqlText from '../../../../../db/import-history.sql?raw';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });
  const statements = sqlText
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('--') && !l.startsWith('PRAGMA'))
    .map((l) => l.replace(/;\s*$/, ''));
  let done = 0;
  try {
    for (let i = 0; i < statements.length; i += 80) {
      await env.DB.batch(statements.slice(i, i + 80).map((s) => env.DB.prepare(s)));
      done += Math.min(80, statements.length - i);
    }
  } catch (e) {
    return redirect(`/admin?importado=${encodeURIComponent(`Error tras ${done} sentencias: ${(e as Error).message.slice(0, 120)}`)}`, 303);
  }
  await env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, payload, actor) VALUES ('import', 0, 'anwp_history', ?, ?)`).bind(JSON.stringify({ statements: done }), locals.session?.user ?? 'desconocido').run();
  return redirect(`/admin?importado=ok:${done}`, 303);
};
