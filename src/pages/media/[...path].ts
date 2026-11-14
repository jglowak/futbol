import type { APIRoute } from 'astro';
import { mediaBucket } from '../../lib/media';

export const GET: APIRoute = async ({ params, request }) => {
  const bucket = mediaBucket();
  const key = params.path ?? '';
  if (!bucket || !key || key.includes('..')) return new Response('No encontrado', { status: 404 });

  const etag = request.headers.get('if-none-match');
  const obj = await bucket.get(key, etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined);
  if (!obj) return new Response('No encontrado', { status: 404 });

  const headers = new Headers({
    'cache-control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400',
    etag: obj.httpEtag,
  });
  if (obj.httpMetadata?.contentType) headers.set('content-type', obj.httpMetadata.contentType);
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
};
