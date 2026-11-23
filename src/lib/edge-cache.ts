// Caché de borde con la Cache API de Cloudflare.
// Un Worker NO cachea sus propias respuestas por poner `Cache-Control: s-maxage`: ese header solo
// lo respetan otros cachés. Para que las páginas y los escudos no peguen siempre a D1/R2 hay que
// guardarlos explícitamente. La Cache API funciona en dominios propios (no en *.workers.dev) y es por
// ubicación (cada punto de presencia de Cloudflare tiene el suyo).

export function edgeCache(): Cache | null {
  if (typeof caches === 'undefined') return null;
  return (caches as unknown as { default?: Cache }).default ?? null;
}

/** Segundos que una respuesta puede vivir en el borde: sale de `s-maxage` si es `public`. */
export function edgeTtl(res: Response): number {
  const cc = res.headers.get('cache-control') ?? '';
  if (!/\bpublic\b/i.test(cc) || /\b(no-store|private)\b/i.test(cc)) return 0;
  const m = cc.match(/s-maxage=(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** Copia para guardar en la caché: vive `ttl` segundos y no lleva cookies. */
export function cacheCopy(res: Response, ttl: number): Response {
  const headers = new Headers(res.headers);
  headers.set('cache-control', `public, max-age=${ttl}`);
  headers.delete('set-cookie');
  return new Response(res.clone().body, { status: res.status, headers });
}
