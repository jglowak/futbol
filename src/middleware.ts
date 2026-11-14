import { defineMiddleware } from 'astro:middleware';
import { getSession } from './lib/auth';

const PROTECTED = [/^\/admin(?!\/login)/, /^\/api\/admin/];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!PROTECTED.some((re) => re.test(pathname))) return next();

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
