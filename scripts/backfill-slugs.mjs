// Genera UPDATEs de slug para partidos sin slug, a partir de un JSON de wrangler d1 execute --json.
// Uso: npx wrangler d1 execute futbol-db --local --json --command "SELECT m.id, m.kickoff_at, COALESCE(h.short_name,h.name) h, COALESCE(a.short_name,a.name) a FROM matches m JOIN clubs h ON h.id=m.home_club_id JOIN clubs a ON a.id=m.away_club_id WHERE m.slug IS NULL" | node scripts/backfill-slugs.mjs
import { readFileSync } from 'node:fs';
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rows = JSON.parse(readFileSync(0, 'utf8'))[0].results;
const used = new Set();
for (const r of rows) {
  let base = `${slugify(r.h)}-vs-${slugify(r.a)}`;
  if (r.kickoff_at) {
    const d = new Date(new Date(r.kickoff_at).getTime() - 3 * 3600_000);
    base += `-${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
  }
  let slug = base, i = 2;
  while (used.has(slug)) slug = `${base}-${i++}`;
  used.add(slug);
  console.log(`UPDATE matches SET slug = '${slug}' WHERE id = ${r.id};`);
}
