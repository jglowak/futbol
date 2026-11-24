import { defineMiddleware } from 'astro:middleware';
import { getSession } from './lib/auth';
import { cacheCopy, edgeCache, edgeTtl } from './lib/edge-cache';

const PROTECTED = [/^\/admin(?!\/login)/, /^\/api\/admin/];
// Rutas que no se cachean acá: el panel, las APIs y /media (que tiene su propia caché).
const NO_EDGE_CACHE = [/^\/admin/, /^\/api\//, /^\/media\//];

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// 30 días: el navegador deja de intentar HTTP con este dominio. Se puede subir más adelante.
const HSTS = 'max-age=2592000';

/** Agrega un header. Las respuestas que salen de la caché (o de un fetch) son de solo lectura:
 *  en ese caso se copia la respuesta primero, si no `headers.set` tira un error y el visitante ve un 500. */
function withHeader(res: Response, name: string, value: string): Response {
  try {
    res.headers.set(name, value);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.set(name, value);
    return copy;
  }
}

/** Todo el sitio, siempre por HTTPS: HTTP se redirige y HTTPS lleva HSTS. */
export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  if (url.protocol === 'http:' && !LOCAL_HOST.test(url.host)) {
    const to = new URL(url);
    to.protocol = 'https:';
    to.port = '';
    // 301 para lectura; 308 para el resto, que conserva el método (un POST no se vuelve GET).
    return Response.redirect(to.toString(), request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
  }
  // handle() siempre resuelve en una Response; el cast evita el Response|void que infiere Astro.
  const res = (await handle(context, next)) as Response;
  return url.protocol === 'https:' ? withHeader(res, 'Strict-Transport-Security', HSTS) : res;
});

const handle = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!PROTECTED.some((re) => re.test(pathname))) {
    // Páginas públicas: caché de borde con el TTL que cada página declara en `s-maxage`.
    const cache = context.request.method === 'GET' && !NO_EDGE_CACHE.some((re) => re.test(pathname)) ? edgeCache() : null;
    if (!cache) return next();
    const key = new Request(context.url.origin + pathname + context.url.search);
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('Cache-Control', 'public, max-age=0');
      res.headers.set('x-edge-cache', 'HIT');
      return res;
    }
    const res = await next();
    const ttl = res.status === 200 ? edgeTtl(res) : 0;
    if (ttl > 0 && !res.headers.has('set-cookie')) {
      const cf = context.locals.cfContext;
      if (cf) {
        cf.waitUntil(cache.put(key, cacheCopy(res, ttl)));
        res.headers.set('x-edge-cache', 'MISS');
      } else {
        res.headers.set('x-edge-cache', 'MISS-sin-contexto'); // no hay dónde colgar el guardado: no se cachea
      }
    }
    return res;
  }

  const session = await getSession(context.request);
  if (!session) {
    if (pathname.startsWith('/api/')) return new Response('No autorizado', { status: 401 });
    return context.redirect(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }
  context.locals.session = session;
  const res = await next();
  res.headers.set('Cache-Control', 'no-store');
  return res;
});
