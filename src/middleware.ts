import { defineMiddleware } from 'astro:middleware';
import { getSession } from './lib/auth';
import { cacheCopy, edgeCache, edgeTtl } from './lib/edge-cache';

const PROTECTED = [/^\/admin(?!\/login)/, /^\/api\/admin/];
// Rutas que no se cachean acá: el panel, las APIs y /media (que tiene su propia caché).
const NO_EDGE_CACHE = [/^\/admin/, /^\/api\//, /^\/media\//];

export const onRequest = defineMiddleware(async (context, next) => {
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
      context.locals.cfContext?.waitUntil(cache.put(key, cacheCopy(res, ttl)));
      res.headers.set('x-edge-cache', 'MISS');
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
