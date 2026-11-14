#!/usr/bin/env node
// Genera SQL para cargar la temporada 2026 de la Liga de Florida a partir de
// los exports de AnWP Football Leagues (WordPress):
//   - XML de clubes (anwp_club)        → nombre, ciudad, escudo
//   - CSV de partidos por competición  → fixture y resultados
//
// Uso:
//   node scripts/import-anwp.mjs --clubs clubes.xml --apertura apertura.csv --clausura clausura.csv > db/seed-2026.sql
//
// No se importan datos personales: los exports no traen jugadores.

import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
for (const k of ['clubs', 'apertura', 'clausura']) {
  if (!args[k]) {
    console.error(`Falta --${k}`);
    process.exit(1);
  }
}

// --- Clubes de la Liga de Florida 2026 (ID de AnWP → nombre corto para mostrar) ---
// Los nombres oficiales vienen del XML; acá solo el nombre corto para pantallas chicas.
const SHORT = {
  264976: ['Nacional de Florida', 'Nacional'],
  273278: ['Club Social y Deportivo Alianza', 'Alianza'],
  273282: ['19 de Abril', '19 de Abril'],
  273284: ['Club Atlético Florida', 'Atlético Florida'],
  273286: ['Club Atlético Avenida', 'Avenida'],
  273293: ['Club Atlético España', 'España'],
  273296: ['La Vascongada', 'La Vascongada'],
  273303: ['Quilmes FL', 'Quilmes'],
  273305: ['River Plate FL', 'River Plate'],
  273314: ['Club Atlético Mendoza', 'Mendoza'],
  273319: ['Boquita', 'Boquita'],
  284548: ['Candil', 'Candil'],
};

// Series del Clausura 2026 (según el panel de AnWP).
const CLAUSURA_GROUPS = {
  'Serie A': [273303, 284548, 273319, 273293, 273282, 273278],
  'Serie B': [264976, 273284, 273286, 273305, 273314, 273296],
};

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// --- Clubes desde el XML ---
const xml = readFileSync(args.clubs, 'utf8');
const clubs = new Map();
for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
  const id = Number(item.match(/<wp:post_id>(\d+)<\/wp:post_id>/)[1]);
  if (!SHORT[id]) continue;
  const meta = {};
  for (const m of item.matchAll(
    /<wp:meta_key><!\[CDATA\[(.*?)\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[([\s\S]*?)\]\]>/g,
  )) {
    meta[m[1]] = m[2];
  }
  clubs.set(id, {
    legacy_id: id,
    name: SHORT[id][0],
    short_name: SHORT[id][1],
    slug: slugify(SHORT[id][0]),
    city: meta._anwpfl_city ? titleCase(meta._anwpfl_city) : null,
    crest_url: meta._anwpfl_logo || null,
  });
}
function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
const missing = Object.keys(SHORT).filter((id) => !clubs.has(Number(id)));
if (missing.length) {
  console.error('Clubes no encontrados en el XML:', missing);
  process.exit(1);
}

// --- Partidos desde CSV ---
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) row.push(field), rows.push(row);
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
// Las horas del CSV están en hora de Uruguay (UTC-3 todo el año).
const toUtc = (local) => new Date(local.replace(' ', 'T') + '-03:00').toISOString();

function matchesFrom(csvPath, stageId, groupOf) {
  const out = [];
  for (const r of parseCsv(readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''))) {
    const home = Number(r['Home Team ID']);
    const away = Number(r['Away Team ID']);
    if (!clubs.has(home) || !clubs.has(away)) {
      console.error(`Club desconocido en partido ${r['Game ID']}: ${home} / ${away}`);
      process.exit(1);
    }
    const finished = r.Finished === '1';
    const g = groupOf ? groupOf(home, away) : '';
    out.push({
      legacy_id: Number(r['Game ID']),
      stage_id: stageId,
      round: `Fecha ${r.MatchWeek}`,
      group_name: g,
      home,
      away,
      kickoff_at: toUtc(r.Kickoff),
      status: finished ? 'finished' : 'scheduled',
      hg: finished ? Number(r['Home Score']) : null,
      ag: finished ? Number(r['Away Score']) : null,
    });
  }
  return out;
}
const groupOfClub = (id) => Object.entries(CLAUSURA_GROUPS).find(([, ids]) => ids.includes(id))?.[0];
const clausuraGroup = (h, a) => {
  const gh = groupOfClub(h),
    ga = groupOfClub(a);
  if (!gh || gh !== ga) {
    console.error(`Partido entre series distintas o club sin serie: ${h} vs ${a}`);
    process.exit(1);
  }
  return gh;
};

const apertura = matchesFrom(args.apertura, 1, null);
const clausura = matchesFrom(args.clausura, 2, clausuraGroup);

// --- SQL ---
const sql = [];
sql.push('-- Generado por scripts/import-anwp.mjs. Temporada 2026, Liga de Fútbol de Florida.');
sql.push('PRAGMA foreign_keys = ON;');
sql.push(`INSERT INTO seasons (id, slug, name, year) VALUES (1, 'temporada-2026', 'Temporada 2026', 2026);`);

let cid = 1;
const dbId = new Map();
for (const c of [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
  dbId.set(c.legacy_id, cid);
  sql.push(
    `INSERT INTO clubs (id, slug, name, short_name, city, crest_url, legacy_id) VALUES (${cid}, ${q(c.slug)}, ${q(c.name)}, ${q(c.short_name)}, ${q(c.city)}, ${q(c.crest_url)}, ${c.legacy_id});`,
  );
  cid++;
}

sql.push(
  `INSERT INTO tournaments (id, season_id, slug, name, category, template, status, legacy_id) VALUES (1, 1, 'apertura-2026', 'Apertura 2026', 'Absoluta', 'apertura_clausura', 'finished', 328443);`,
);
sql.push(
  `INSERT INTO tournaments (id, season_id, slug, name, category, template, status, legacy_id) VALUES (2, 1, 'clausura-2026', 'Clausura 2026', 'Absoluta', 'apertura_clausura', 'ongoing', 331677);`,
);
sql.push(
  `INSERT INTO stages (id, tournament_id, position, name, kind, config) VALUES (1, 1, 1, 'Fase regular', 'league', '{"legs":1}');`,
);
sql.push(
  `INSERT INTO stages (id, tournament_id, position, name, kind, config) VALUES (2, 2, 1, 'Series', 'groups', '{"legs":1,"advance_per_group":2}');`,
);
for (const legacy of dbId.keys()) {
  sql.push(`INSERT INTO stage_clubs (stage_id, club_id, group_name) VALUES (1, ${dbId.get(legacy)}, '');`);
}
for (const [g, ids] of Object.entries(CLAUSURA_GROUPS)) {
  for (const legacy of ids) {
    sql.push(`INSERT INTO stage_clubs (stage_id, club_id, group_name) VALUES (2, ${dbId.get(legacy)}, ${q(g)});`);
  }
}

let mid = 1;
for (const m of [...apertura, ...clausura]) {
  sql.push(
    `INSERT INTO matches (id, stage_id, round, group_name, home_club_id, away_club_id, kickoff_at, status, home_goals, away_goals, legacy_id) VALUES (${mid++}, ${m.stage_id}, ${q(m.round)}, ${q(m.group_name)}, ${dbId.get(m.home)}, ${dbId.get(m.away)}, ${q(m.kickoff_at)}, ${q(m.status)}, ${m.hg ?? 'NULL'}, ${m.ag ?? 'NULL'}, ${m.legacy_id});`,
  );
}

const cfg = `'{"tiebreakers":["goal_difference","goals_for"]}'`;
sql.push(`INSERT INTO standing_tables (id, season_id, slug, name, config) VALUES (1, 1, 'apertura-2026', 'Tabla del Apertura 2026', ${cfg});`);
sql.push(`INSERT INTO standing_tables (id, season_id, slug, name, config) VALUES (2, 1, 'clausura-2026-serie-a', 'Clausura 2026 · Serie A', ${cfg});`);
sql.push(`INSERT INTO standing_tables (id, season_id, slug, name, config) VALUES (3, 1, 'clausura-2026-serie-b', 'Clausura 2026 · Serie B', ${cfg});`);
sql.push(`INSERT INTO standing_tables (id, season_id, slug, name, config) VALUES (4, 1, 'anual-2026', 'Tabla Anual 2026 (Apertura + Clausura)', ${cfg});`);
sql.push(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (1, 1, '');`);
sql.push(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (2, 2, 'Serie A');`);
sql.push(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (3, 2, 'Serie B');`);
sql.push(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (4, 1, '');`);
sql.push(`INSERT INTO standing_table_sources (table_id, stage_id, group_name) VALUES (4, 2, '');`);

console.log(sql.join('\n'));
console.error(`OK: ${clubs.size} clubes, ${apertura.length} partidos Apertura, ${clausura.length} partidos Clausura.`);
