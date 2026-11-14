// Relato y fotos de un partido.
import { env } from 'cloudflare:workers';
import { mediaBucket } from './media';

export interface MatchPost {
  id: number;
  match_id: number;
  minute: number | null;
  kind: string;
  body: string;
  created_at: string;
  created_by: string | null;
}
export interface MatchPhoto {
  id: number;
  match_id: number;
  key: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export const POST_KINDS: Record<string, string> = {
  text: 'Relato',
  goal: 'Gol',
  card: 'Tarjeta',
  sub: 'Cambio',
  start: 'Inicio',
  end: 'Final',
  info: 'Info',
};

export async function listPosts(matchId: number): Promise<MatchPost[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, match_id, minute, kind, body, created_at, created_by
     FROM match_posts WHERE match_id = ? AND deleted_at IS NULL ORDER BY id DESC`,
  )
    .bind(matchId)
    .all<MatchPost>();
  return results;
}

export async function addPost(matchId: number, data: { minute: number | null; kind: string; body: string }, actor: string) {
  const kind = POST_KINDS[data.kind] ? data.kind : 'text';
  const body = data.body.trim().slice(0, 2000);
  if (!body) return null;
  const res = await env.DB.prepare(
    `INSERT INTO match_posts (match_id, minute, kind, body, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(matchId, data.minute, kind, body, actor)
    .first<{ id: number }>();
  return res?.id ?? null;
}

export async function deletePost(postId: number, actor: string) {
  await env.DB.prepare(`UPDATE match_posts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`).bind(postId).run();
  await env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ('match_post', ?, 'delete', ?)`).bind(postId, actor).run();
}

export async function listPhotos(matchId: number): Promise<MatchPhoto[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, match_id, key, caption, width, height, created_at
     FROM match_photos WHERE match_id = ? AND deleted_at IS NULL ORDER BY position, id`,
  )
    .bind(matchId)
    .all<MatchPhoto>();
  return results;
}

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export async function addPhoto(
  matchId: number,
  file: File,
  meta: { caption: string | null; width: number | null; height: number | null },
  actor: string,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const bucket = mediaBucket();
  if (!bucket) return { ok: false, error: 'R2 no configurado' };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { ok: false, error: 'Formato no permitido' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'La foto supera 4 MB' };
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `partidos/${matchId}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const res = await env.DB.prepare(
    `INSERT INTO match_photos (match_id, key, caption, width, height, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(matchId, key, meta.caption, meta.width, meta.height, actor)
    .first<{ id: number }>();
  return { ok: true, id: res!.id };
}

export async function deletePhoto(photoId: number, actor: string) {
  const row = await env.DB.prepare(`SELECT key FROM match_photos WHERE id = ? AND deleted_at IS NULL`).bind(photoId).first<{ key: string }>();
  if (!row) return;
  await env.DB.prepare(`UPDATE match_photos SET deleted_at = datetime('now') WHERE id = ?`).bind(photoId).run();
  await mediaBucket()?.delete(row.key);
  await env.DB.prepare(`INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ('match_photo', ?, 'delete', ?)`).bind(photoId, actor).run();
}
