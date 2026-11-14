// Archivos (escudos, fotos) en R2, servidos por el propio Worker en /media/<clave>.
import { env } from 'cloudflare:workers';

type WithMedia = { MEDIA?: R2Bucket };

export function mediaBucket(): R2Bucket | null {
  return (env as unknown as WithMedia).MEDIA ?? null;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export function extensionFor(contentType: string | null, url: string): string {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct];
  const m = url.toLowerCase().match(/\.(png|jpe?g|gif|webp|svg|avif)(?:\?|$)/);
  return m ? m[1].replace('jpeg', 'jpg') : 'bin';
}

export function isImageType(contentType: string | null): boolean {
  return Boolean(contentType && EXT_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()]);
}

/** Descarga una URL y la guarda en R2. Devuelve la ruta pública (/media/...). */
export async function copyUrlToMedia(sourceUrl: string, keyBase: string): Promise<string> {
  const bucket = mediaBucket();
  if (!bucket) throw new Error('R2 no configurado (binding MEDIA)');
  const res = await fetch(sourceUrl, { headers: { 'user-agent': 'futbol-media-sync/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type');
  if (!isImageType(type)) throw new Error(`No es imagen (${type ?? 'sin tipo'})`);
  const body = await res.arrayBuffer();
  if (body.byteLength > 5 * 1024 * 1024) throw new Error('Archivo demasiado grande');
  const key = `${keyBase}.${extensionFor(type, sourceUrl)}`;
  await bucket.put(key, body, { httpMetadata: { contentType: type ?? 'application/octet-stream' } });
  return `/media/${key}`;
}
