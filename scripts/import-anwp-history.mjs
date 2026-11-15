#!/usr/bin/env node
// Importa el histórico de AnWP (exports XML de WordPress) y genera SQL idempotente:
//   clubes (unificando duplicados), estadios (cancha habitual), competiciones → torneos/etapas,
//   tablas finales → tablas "históricas" cargadas como totales.
// Uso:
//   node scripts/import-anwp-history.mjs --clubs clubes.xml --competitions competiciones.xml \
//        --standings tablas.xml --stadiums estadios.xml --out db/import-history.sql --report /tmp/report.md
// No importa partidos (el export de WordPress no trae resultados).

import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
for (const k of ['clubs', 'competitions', 'standings', 'stadiums', 'out', 'matches']) if (!args[k]) { console.error(`Falta --${k}`); process.exit(1); }

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8217;/g, '’');
function items(path) {
  const xml = readFileSync(path, 'utf8');
  const out = [];
  for (const it of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const d = {
      title: unescape((it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1] ?? '').trim(),
      id: Number(it.match(/<wp:post_id>(\d+)<\/wp:post_id>/)[1]),
      date: (it.match(/<wp:post_date><!\[CDATA\[(.*?)\]\]>/) ?? [])[1] ?? '',
      status: (it.match(/<wp:status><!\[CDATA\[(.*?)\]\]>/) ?? [])[1] ?? '',
    };
    for (const m of it.matchAll(/<wp:meta_key><!\[CDATA\[(.*?)\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[([\s\S]*?)\]\]>/g)) {
      if (m[1].startsWith('_anwpfl_')) d[m[1].slice(8)] = m[2];
    }
    out.push(d);
  }
  return out;
}
const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const qs = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`; // cadena, '' se conserva (group_name, round)
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['club', 'atletico', 'deportivo', 'social', 'y', 'de', 'futbol', 'c', 'a', 'd', 's', 'ca', 'cd', 'csd', 'csyd', 'institucion', 'asociacion']);
const core = (s) => norm(s).split(' ').filter((w) => !STOP.has(w)).join(' ');
const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(\-])\S/g, (c) => c.toUpperCase()).replace(/\bDe\b/g, 'de').replace(/\bY\b/g, 'y').replace(/\bFb\b/, 'FB') : s);

// ---------- Clubes ----------
const clubs = items(args.clubs).filter((c) => c.status === 'publish');
// IDs que ya existen en nuestra base (temporada 2026): se mantienen como canónicos.
const EXISTING = new Set([264976, 273278, 273282, 273284, 273286, 273293, 273296, 273303, 273305, 273314, 273319, 284548]);
// Grupos que NO se unifican (entidades distintas o dudosas): se dejan tal cual.
const KEEP_SEPARATE = new Set([282890 /* 'Florida' (selección) */, 288894 /* Juventud sin ciudad */, 288893 /* Peñarol sin ciudad */, 288892 /* San Carlos sin ciudad */]);

// Unificaciones explícitas: versiones viejas de clubes actuales cuyo nombre lleva sufijo.
const FORCE_GROUP = new Map([
  [270250, 'nacional florida'], [273298, 'nacional florida'], [284550, 'nacional florida'], // → Nacional de Florida (264976)
  [270248, 'river plate fl'], [284552, 'river plate fl'], // → River Plate FL (273305)
  [270249, 'quilmes fl'], [284551, 'quilmes fl'], [265009, 'quilmes fl'], // → Quilmes FL (273303)
]);
const groups = new Map();
for (const c of clubs) {
  const key = KEEP_SEPARATE.has(c.id) ? `#${c.id}` : FORCE_GROUP.get(c.id) ?? (core(c.title) || norm(c.title));
  groups.set(key, [...(groups.get(key) ?? []), c]);
}
const merges = []; // [canonical, ...others]
const canonicalOf = new Map(); // legacy id → canonical legacy id
const canonClubs = [];
for (const [, members] of groups) {
  members.sort((a, b) => {
    const ea = EXISTING.has(a.id) ? 0 : 1, eb = EXISTING.has(b.id) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    const la = a.logo ? 0 : 1, lb = b.logo ? 0 : 1;
    if (la !== lb) return la - lb;
    const ca = a.city ? 0 : 1, cb = b.city ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return b.title.length - a.title.length; // nombre más completo
  });
  const canon = members[0];
  for (const m of members) canonicalOf.set(m.id, canon.id);
  if (members.length > 1) merges.push(members);
  const city = members.map((m) => m.city).find(Boolean);
  const logo = members.map((m) => m.logo).find(Boolean);
  canonClubs.push({
    legacy_id: canon.id,
    name: titleCase(canon.title.trim()),
    short_name: (canon.abbr || '').trim() || null,
    city: city ? titleCase(city.trim()) : null,
    crest_url: logo || null,
    founded: canon.founded && /^\d{4}$/.test(canon.founded) ? Number(canon.founded) : null,
  });
}

// ---------- Estadios ----------
const stadiums = items(args.stadiums);
const venueOfClub = new Map();
for (const s of stadiums) {
  // PHP serializado: a:2:{i:0;s:6:"282868";i:1;s:6:"264939";}
  let ids = [...(s.clubs || '').matchAll(/s:\d+:"(\d{5,})"/g)].map((m) => Number(m[1]));
  if (ids.length === 0) { try { ids = JSON.parse(s.clubs || '[]').map(Number); } catch { ids = []; } }
  const label = s.city && !norm(s.title).includes(norm(s.city)) ? `${s.title} (${s.city})` : s.title;
  for (const id of ids) if (!venueOfClub.has(Number(id))) venueOfClub.set(Number(id), label);
}

// ---------- Competiciones ----------
const comps = items(args.competitions).filter((c) => c.status === 'publish');
const SKIP_COMPS = new Set([328443, 331677]); // Apertura y Clausura 2026 ya existen
const byId = new Map(comps.map((c) => [c.id, c]));
const yearOf = (c) => Number((c.title.match(/\b(20\d\d)\b/) ?? [])[1] ?? c.date.slice(0, 4));
const mains = comps.filter((c) => c.multistage !== 'secondary' && !SKIP_COMPS.has(c.id));
const secondaries = comps.filter((c) => c.multistage === 'secondary');
const stagesOf = (main) => [main, ...secondaries.filter((s) => Number(s.multistage_main) === main.id).sort((a, b) => Number(a.stage_order || 0) - Number(b.stage_order || 0))];
const parseGroups = (c) => { try { return JSON.parse(c.groups || '[]'); } catch { return []; } };

// ---------- Tablas ----------
const standings = items(args.standings).filter((s) => s.status === 'publish' && s.table_main && s.table_main.length > 10);

// ---------- SQL ----------
const sql = [];
const P = (s) => sql.push(s);
P('-- Generado por scripts/import-anwp-history.mjs. Idempotente: usa legacy_id / INSERT OR IGNORE.');
P('PRAGMA foreign_keys = ON;');

// Temporadas por año
const years = new Set(mains.map(yearOf));
for (const y of [...years].sort()) P(`INSERT OR IGNORE INTO seasons (slug, name, year) VALUES ('temporada-${y}', 'Temporada ${y}', ${y});`);

// Clubes
const usedSlugsGlobal = new Set();
const usedSlugs = new Set(['19-de-abril', 'boquita', 'candil', 'club-atletico-avenida', 'club-atletico-espana', 'club-atletico-florida', 'club-atletico-mendoza', 'club-social-y-deportivo-alianza', 'la-vascongada', 'nacional-de-florida', 'quilmes-fl', 'river-plate-fl']);
for (const c of canonClubs) {
  if (EXISTING.has(c.legacy_id)) {
    // Completar ciudad/cancha de los existentes sin pisar nombre ni escudo.
    if (c.city) P(`UPDATE clubs SET city = COALESCE(city, ${q(c.city)}) WHERE legacy_id = ${c.legacy_id};`);
  } else {
    let slug = slugify(c.name) || `club-${c.legacy_id}`; let i = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(c.name)}-${i++}`;
    usedSlugs.add(slug);
    P(`INSERT OR IGNORE INTO clubs (slug, name, short_name, city, founded_year, crest_url, legacy_id) VALUES (${q(slug)}, ${q(c.name)}, ${q(c.short_name)}, ${q(c.city)}, ${c.founded ?? 'NULL'}, ${q(c.crest_url)}, ${c.legacy_id});`);
  }
}
for (const [legacy, canon] of canonicalOf) P(`INSERT OR IGNORE INTO club_legacy_ids (legacy_id, club_id) SELECT ${legacy}, id FROM clubs WHERE legacy_id = ${canon};`);
const CLUB = (legacy) => `(SELECT club_id FROM club_legacy_ids WHERE legacy_id = ${legacy})`;
for (const [legacy, venue] of venueOfClub) P(`UPDATE clubs SET home_venue = ${q(venue)} WHERE id = ${CLUB(legacy)} AND home_venue IS NULL;`);

// Torneos, etapas, participantes
const usedTSlugs = new Set(['apertura-2026', 'clausura-2026', 'temporada-2026']);
const stageKeyOf = new Map(); // competition id → expresión SQL del stage id
for (const main of mains) {
  const y = yearOf(main);
  let tslug = slugify(main.title) || `torneo-${main.id}`; let i = 2;
  while (usedTSlugs.has(tslug)) tslug = `${slugify(main.title)}-${i++}`;
  usedTSlugs.add(tslug);
  const cat = /sub ?(\d+)/i.test(main.title) ? `Sub ${main.title.match(/sub ?(\d+)/i)[1]}` : 'Absoluta';
  P(`INSERT OR IGNORE INTO tournaments (season_id, slug, name, category, template, status, legacy_id, source) SELECT id, ${q(tslug)}, ${q(main.title)}, ${q(cat)}, 'importado', 'finished', ${main.id}, 'anwp' FROM seasons WHERE year = ${y};`);
  const T = `(SELECT id FROM tournaments WHERE legacy_id = ${main.id})`;
  stagesOf(main).forEach((st, pos) => {
    const groups = parseGroups(st);
    const kind = st.type === 'knockout' ? 'knockout' : groups.length > 1 ? 'groups' : 'league';
    const name = st.multistage === 'secondary' ? (st.stage_title || `Etapa ${pos + 1}`) : groups.length > 1 ? 'Grupos' : kind === 'knockout' ? 'Eliminatoria' : 'Fase regular';
    const cfg = JSON.stringify({ legs: st.format_robin === 'double' ? 2 : 1, anwp_type: st.type || null, anwp_knockout: st.format_knockout || null });
    P(`INSERT OR IGNORE INTO stages (tournament_id, position, name, kind, config) SELECT ${T}, ${pos + 1}, ${q(name)}, ${q(kind)}, ${q(cfg)} WHERE NOT EXISTS (SELECT 1 FROM stages WHERE tournament_id = ${T} AND position = ${pos + 1});`);
    const S = `(SELECT id FROM stages WHERE tournament_id = ${T} AND position = ${pos + 1})`;
    stageKeyOf.set(st.id, { S, groups });
    for (const g of groups) {
      const gname = groups.length > 1 ? g.title : '';
      for (const cid of g.clubs ?? []) P(`INSERT OR IGNORE INTO stage_clubs (stage_id, club_id, group_name) SELECT ${S}, ${CLUB(cid)}, ${qs(gname)} WHERE ${CLUB(cid)} IS NOT NULL;`);
    }
  });
}

// Tablas históricas (totales)
const report = ['# Importación AnWP — informe', '', `Clubes: ${clubs.length} en AnWP → ${canonClubs.length} unificados.`, '', '## Clubes unificados', ''];
for (const m of merges) report.push(`- **${titleCase(m[0].title)}** ← ${m.slice(1).map((x) => `${x.title}${x.city ? ` (${x.city})` : ''} [#${x.id}]`).join(', ')}`);
report.push('', '## Dejados separados (confirmar con Jorge)', '', '- "Florida" [#282890]: parece la selección departamental, no Atlético Florida.', '- "Juventud" [#288894], "Peñarol" [#288893], "San Carlos" [#288892]: sin ciudad; podrían ser de Colonia/Rivera o de otra liga.', '', '## Tablas importadas y probable campeón (1° de cada tabla)', '', '| Competición | Tabla | 1° | Pts | PJ |', '| --- | --- | --- | --- | --- |');
const usedTbl = new Set(['apertura-2026', 'clausura-2026-serie-a', 'clausura-2026-serie-b', 'anual-2026']);
let tablesCount = 0, rowsCount = 0;
for (const s of standings) {
  const compId = Number(s.competition);
  const comp = byId.get(compId);
  if (!comp || SKIP_COMPS.has(compId)) continue;
  const key = stageKeyOf.get(compId);
  if (!key) continue;
  const main = comp.multistage === 'secondary' ? byId.get(Number(comp.multistage_main)) : comp;
  if (!main) continue;
  const grp = key.groups.find((g) => Number(g.id) === Number(s.competition_group));
  const gname = key.groups.length > 1 && grp ? grp.title : '';
  let rows; try { rows = JSON.parse(s.table_main); } catch { continue; }
  if (!Array.isArray(rows) || rows.length === 0) continue;
  const y = yearOf(main);
  let tslug = slugify(`${s.title} ${y}`) || `tabla-${s.id}`; let i = 2;
  while (usedTbl.has(tslug)) tslug = `${slugify(`${s.title} ${y}`)}-${i++}`;
  usedTbl.add(tslug);
  const rules = (s.ranking_rules_current || 'goals_difference,goals_scored').split(',').map((r) => ({ goals_difference: 'goal_difference', goals_scored: 'goals_for', wins: 'wins' }[r.trim()])).filter(Boolean);
  const cfg = JSON.stringify({ tiebreakers: rules, snapshot: true, source: 'anwp', note: 'Tabla final importada de AnWP; sin partidos cargados.' });
  P(`INSERT OR IGNORE INTO standing_tables (season_id, slug, name, config, legacy_id) SELECT id, ${q(tslug)}, ${q(s.title)}, ${q(cfg)}, ${s.id} FROM seasons WHERE year = ${y};`);
  const TB = `(SELECT id FROM standing_tables WHERE legacy_id = ${s.id})`;
  P(`INSERT OR IGNORE INTO standing_table_sources (table_id, stage_id, group_name) SELECT ${TB}, ${key.S}, ${qs(gname)};`);
  for (const r of rows) {
    const cid = Number(r.club_id);
    P(`INSERT OR REPLACE INTO stage_clubs (stage_id, club_id, group_name) SELECT ${key.S}, ${CLUB(cid)}, ${qs(gname)} WHERE ${CLUB(cid)} IS NOT NULL;`);
    P(`INSERT INTO standing_adjustments (table_id, club_id, points, goals_for, goals_against, played, won, drawn, lost, reason) SELECT ${TB}, ${CLUB(cid)}, ${Number(r.points) || 0}, ${Number(r.gf) || 0}, ${Number(r.ga) || 0}, ${Number(r.played) || 0}, ${Number(r.won) || 0}, ${Number(r.drawn) || 0}, ${Number(r.lost) || 0}, 'Tabla final importada de AnWP' WHERE ${CLUB(cid)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM standing_adjustments WHERE table_id = ${TB} AND club_id = ${CLUB(cid)});`);
    rowsCount++;
  }
  tablesCount++;
  const top = rows.find((r) => Number(r.place) === 1) ?? rows[0];
  report.push(`| ${main.title} | ${s.title} | ${top.club_title} | ${top.points} | ${top.played} |`);
}
// ---------- Partidos (tabla wp_anwpfl_matches, ya parseada a JSON) ----------
const matches = JSON.parse(readFileSync(args.matches, 'utf8'));
const stadiumTitle = new Map(stadiums.map((st) => [st.id, st.city && !norm(st.title).includes(norm(st.city)) ? `${st.title} (${st.city})` : st.title]));
const toUtc = (local) => (!local || local.startsWith('0000') ? null : new Date(local.replace(' ', 'T') + '-03:00').toISOString());
let matchCount = 0, eventCount = 0;
const usedMatchSlugs = new Set();
for (const m of matches) {
  const compId = Number(m.competition_id);
  const key = stageKeyOf.get(compId);
  if (!key) continue; // competiciones de 2026 ya cargadas u omitidas
  const grp = key.groups.find((g) => Number(g.id) === Number(m.group_id));
  const gname = key.groups.length > 1 && grp ? grp.title : '';
  const finished = m.finished === '1';
  const kickoff = toUtc(m.kickoff);
  const round = Number(m.match_week) > 0 ? `Fecha ${Number(m.match_week)}` : '';
  // Penales: eventos penalty_shootout con scored = 'yes'
  let events = [];
  try { events = m.match_events ? JSON.parse(m.match_events) : []; } catch { events = []; }
  const pens = { [m.home_club]: 0, [m.away_club]: 0 };
  let hasPens = false;
  for (const e of events) if (e.type === 'penalty_shootout') { hasPens = true; if (e.scored === 'yes') pens[e.club] = (pens[e.club] ?? 0) + 1; }
  const hNames = canonClubs.find((c) => c.legacy_id === canonicalOf.get(Number(m.home_club)))?.name ?? m.home_club;
  const aNames = canonClubs.find((c) => c.legacy_id === canonicalOf.get(Number(m.away_club)))?.name ?? m.away_club;
  const base = kickoff ? `${slugify(hNames)}-vs-${slugify(aNames)}-${(() => { const d = new Date(new Date(kickoff).getTime() - 3 * 3600_000); return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`; })()}` : `${slugify(hNames)}-vs-${slugify(aNames)}-${m.match_id}`;
  let slug = base; let i = 2;
  while (usedMatchSlugs.has(slug) || usedSlugsGlobal.has(slug)) slug = `${base}-${i++}`;
  usedMatchSlugs.add(slug);
  const venue = stadiumTitle.get(Number(m.stadium_id)) ?? null;
  P(`INSERT OR IGNORE INTO matches (stage_id, round, group_name, home_club_id, away_club_id, kickoff_at, venue, status, home_goals, away_goals, home_pens, away_pens, finished_at, slug, legacy_id) SELECT ${key.S}, ${qs(round)}, ${qs(gname)}, ${CLUB(m.home_club)}, ${CLUB(m.away_club)}, ${q(kickoff)}, ${q(venue)}, ${q(finished ? 'finished' : 'scheduled')}, ${finished ? Number(m.home_goals) : 'NULL'}, ${finished ? Number(m.away_goals) : 'NULL'}, ${hasPens ? pens[m.home_club] : 'NULL'}, ${hasPens ? pens[m.away_club] : 'NULL'}, ${q(finished ? kickoff : null)}, ${q(slug)}, ${Number(m.match_id)} WHERE ${CLUB(m.home_club)} IS NOT NULL AND ${CLUB(m.away_club)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM matches WHERE slug = ${q(slug)} AND legacy_id IS NOT ${Number(m.match_id)});`);
  matchCount++;
  const M = `(SELECT id FROM matches WHERE legacy_id = ${Number(m.match_id)})`;
  for (const e of events) {
    if (!/^\d+$/.test(String(e.club ?? ''))) continue; // evento sin club: no se puede asignar
    let type = null;
    if (e.type === 'goal') type = e.ownGoal === 'yes' || e.ownGoal === true ? 'own_goal' : e.fromPenalty === 'yes' || e.fromPenalty === true ? 'penalty_goal' : 'goal';
    else if (e.type === 'card') type = e.card === 'r' || e.card === 'yr' ? 'red_card' : 'yellow_card';
    else if (e.type === 'substitute') type = 'sub';
    if (!type) continue;
    const minute = Number(e.minute) || null;
    const pref = e.player ? String(e.player) : null;
    P(`INSERT OR IGNORE INTO match_events (match_id, club_id, type, minute, legacy_player_ref, legacy_event_id, created_by) SELECT ${M}, ${CLUB(e.club)}, ${q(type)}, ${minute ?? 'NULL'}, ${q(pref)}, ${q(`${m.match_id}:${e.id}`)}, 'anwp' WHERE ${M} IS NOT NULL AND ${CLUB(e.club)} IS NOT NULL;`);
    eventCount++;
  }
}
// Las tablas históricas ya tienen sus partidos: dejan de ser "congeladas".
P(`DELETE FROM standing_adjustments WHERE reason = 'Tabla final importada de AnWP' AND table_id IN (SELECT st.id FROM standing_tables st JOIN standing_table_sources src ON src.table_id = st.id JOIN matches m ON m.stage_id = src.stage_id AND m.status = 'finished' WHERE st.legacy_id IS NOT NULL);`);
P(`UPDATE standing_tables SET config = json_remove(config, '$.snapshot', '$.note') WHERE legacy_id IS NOT NULL AND id IN (SELECT src.table_id FROM standing_table_sources src JOIN matches m ON m.stage_id = src.stage_id AND m.status = 'finished');`);
P(`-- ${canonClubs.length} clubes, ${mains.length} torneos, ${tablesCount} tablas, ${rowsCount} filas, ${matchCount} partidos, ${eventCount} eventos.`);
report.push('', `## Partidos: ${matchCount} importados (${eventCount} eventos: goles, tarjetas, cambios).`);
writeFileSync(args.out, sql.join('\n') + '\n');
if (args.report) writeFileSync(args.report, report.join('\n') + '\n');
console.error(`OK: ${canonClubs.length} clubes, ${matchCount} partidos, ${eventCount} eventos; ${mains.length} torneos (${merges.length} unificaciones), ${tablesCount} tablas, ${rowsCount} filas, ${sql.length} sentencias.`);
