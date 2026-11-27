import { describe, expect, it } from 'vitest';
import { computeAllTies, resolveTableRank, seasonSummary, type Context, type TieDef, type TieMatch, type TableInfo } from './phases-core';
import type { StandingRow } from './standings';

// Clubes: 1 Quilmes, 2 Nacional, 3 Candil, 4 España, 5 Boquita, 6 Mendoza
const row = (clubId: number, points: number, gd = 0, gf = 0): StandingRow => ({
  position: 0, clubId, name: `Club ${clubId}`, shortName: null, crestUrl: null, slug: null,
  played: 0, won: 0, drawn: 0, lost: 0, goalsFor: gf, goalsAgainst: gf - gd, goalDifference: gd, points,
  pointsAdjustment: 0, adjustmentReasons: [], live: false, positionChange: 0,
});
const table = (name: string, rows: StandingRow[], pending = 0, positionOverrides: Record<string, number> = {}): TableInfo => ({
  name, rows: rows.map((r, i) => ({ ...r, position: i + 1 })), pending, positionOverrides,
});

const CFG = {
  apertura_table: 'apertura', clausura_final: 'clausura-final', anual_table: 'anual',
  final: 'final', final_extra: 'final-extra', final_anual: 'final-anual',
};

const TIES: TieDef[] = [
  { code: 'sf1', label: 'Semifinal 1', home_ref: { type: 'table_rank', table: 'serie-a', rank: 1 }, away_ref: { type: 'table_rank', table: 'serie-b', rank: 2 }, condition: null, neutral: false, home_override_club_id: null, away_override_club_id: null, match_id: null },
  { code: 'sf2', label: 'Semifinal 2', home_ref: { type: 'table_rank', table: 'serie-b', rank: 1 }, away_ref: { type: 'table_rank', table: 'serie-a', rank: 2 }, condition: null, neutral: false, home_override_club_id: null, away_override_club_id: null, match_id: null },
  { code: 'clausura-final', label: 'Final del Clausura', home_ref: { type: 'tie_winner', tie: 'sf1' }, away_ref: { type: 'tie_winner', tie: 'sf2' }, condition: null, neutral: true, home_override_club_id: null, away_override_club_id: null, match_id: null },
  { code: 'final', label: 'Final de la Temporada', home_ref: { type: 'table_rank', table: 'apertura', rank: 1 }, away_ref: { type: 'tie_winner', tie: 'clausura-final' },
    condition: { type: 'distinct', a: { type: 'table_rank', table: 'apertura', rank: 1 }, b: { type: 'tie_winner', tie: 'clausura-final' } }, neutral: true, home_override_club_id: null, away_override_club_id: null, match_id: null },
  { code: 'final-extra', label: 'Final extra', home_ref: { type: 'tie_loser', tie: 'final' }, away_ref: { type: 'tie_winner', tie: 'final' },
    condition: { type: 'equals', a: { type: 'tie_loser', tie: 'final' }, b: { type: 'table_rank', table: 'anual', rank: 1 } }, neutral: true, home_override_club_id: null, away_override_club_id: null, match_id: null },
  { code: 'final-anual', label: 'Final con el 1° de la Anual', home_ref: { type: 'table_rank', table: 'anual', rank: 1 }, away_ref: { type: 'tie_winner', tie: 'final' },
    condition: { type: 'not_in', ref: { type: 'table_rank', table: 'anual', rank: 1 }, set: [{ type: 'table_rank', table: 'apertura', rank: 1 }, { type: 'tie_winner', tie: 'clausura-final' }] }, neutral: true, home_override_club_id: null, away_override_club_id: null, match_id: null },
];

const played = (id: number, home: number, away: number, hg: number, ag: number, pens?: [number, number]): TieMatch => ({
  id, status: 'finished', home_club_id: home, away_club_id: away, home_goals: hg, away_goals: ag,
  home_pens: pens?.[0] ?? null, away_pens: pens?.[1] ?? null,
});

function ctxWith(opts: { apertura1: number; anual1: number; clausuraWinner: number; clausuraLoser: number; finals?: Record<string, TieMatch> }): Context {
  const tables = new Map<string, TableInfo>([
    ['apertura', table('Apertura', [row(opts.apertura1, 24), row(99, 20)])],
    ['anual', table('Anual', [row(opts.anual1, 40), row(98, 30)])],
    ['serie-a', table('Serie A', [row(opts.clausuraWinner, 12), row(5, 9)])],
    ['serie-b', table('Serie B', [row(opts.clausuraLoser, 11), row(6, 8)])],
  ]);
  const matches = new Map<number, TieMatch>([
    [1, played(1, opts.clausuraWinner, 6, 2, 0)],
    [2, played(2, opts.clausuraLoser, 5, 1, 0)],
    [3, played(3, opts.clausuraWinner, opts.clausuraLoser, 1, 0)],
  ]);
  const ties = TIES.map((t) => ({ ...t }));
  ties[0].match_id = 1; ties[1].match_id = 2; ties[2].match_id = 3;
  let next = 10;
  for (const [code, m] of Object.entries(opts.finals ?? {})) {
    const id = next++;
    matches.set(id, { ...m, id });
    ties.find((t) => t.code === code)!.match_id = id;
  }
  return { tables, ties, matches };
}

describe('llaves del Clausura', () => {
  it('semifinales pendientes mientras falten partidos de series', () => {
    const ctx = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2 });
    ctx.tables.get('serie-a')!.pending = 3;
    ctx.ties.forEach((t) => (t.match_id = null));
    const st = computeAllTies(ctx);
    expect(st.get('sf1')!.status).toBe('pending');
    expect(st.get('sf1')!.home.reason).toMatch(/faltan 3 partidos/);
    expect(st.get('sf2')!.status).toBe('pending'); // Serie B cerrada, pero necesita al 2° de la Serie A
    expect(st.get('sf2')!.home.club).toBe(2);
    expect(st.get('sf2')!.away.club).toBeNull();
  });

  it('cruces 1°A vs 2°B y 1°B vs 2°A, final entre ganadores', () => {
    const ctx = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2 });
    ctx.ties.forEach((t) => (t.match_id = null));
    const st = computeAllTies(ctx);
    expect([st.get('sf1')!.home.club, st.get('sf1')!.away.club]).toEqual([3, 6]);
    expect([st.get('sf2')!.home.club, st.get('sf2')!.away.club]).toEqual([2, 5]);
    expect(st.get('clausura-final')!.status).toBe('pending');
  });

  it('empate sin penales deja la llave sin definir', () => {
    const ctx = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2 });
    ctx.matches.set(3, played(3, 3, 2, 1, 1));
    const st = computeAllTies(ctx);
    expect(st.get('clausura-final')!.needsDecision).toBe(true);
    expect(st.get('clausura-final')!.winner).toBeNull();
    ctx.matches.set(3, played(3, 3, 2, 1, 1, [4, 3]));
    expect(computeAllTies(ctx).get('clausura-final')!.winner).toBe(3);
  });
});

describe('definición de temporada (art. 5)', () => {
  it('A: mismo campeón → campeón de temporada, finales no se juegan', () => {
    const ctx = ctxWith({ apertura1: 3, anual1: 3, clausuraWinner: 3, clausuraLoser: 2 });
    const s = seasonSummary(CFG, ctx);
    expect(s.rule).toBe('A');
    expect(s.seasonChampion.club).toBe(3);
    const st = computeAllTies(ctx);
    expect(st.get('final')!.status).toBe('not_needed');
    expect(st.get('final-anual')!.status).toBe('not_needed');
  });

  it('B: campeones distintos, el 1° de la Anual gana la final → campeón', () => {
    const ctx = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2 });
    let s = seasonSummary(CFG, ctx);
    expect(s.rule).toBe('B');
    expect(s.seasonChampion.club).toBeNull();
    expect(computeAllTies(ctx).get('final')!.status).toBe('ready');
    const ctx2 = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2, finals: { final: played(0, 1, 3, 2, 0) } });
    s = seasonSummary(CFG, ctx2);
    expect(s.rule).toBe('B');
    expect(s.seasonChampion.club).toBe(1);
    expect(computeAllTies(ctx2).get('final-extra')!.status).toBe('not_needed');
  });

  it('C: el 1° de la Anual pierde la final → final extra; su ganador es campeón', () => {
    const ctx = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2, finals: { final: played(0, 1, 3, 0, 1) } });
    let s = seasonSummary(CFG, ctx);
    expect(s.rule).toBe('C');
    expect(s.seasonChampion.club).toBeNull();
    const extra = computeAllTies(ctx).get('final-extra')!;
    expect(extra.status).toBe('ready');
    expect([extra.home.club, extra.away.club]).toEqual([1, 3]);
    const ctx2 = ctxWith({ apertura1: 1, anual1: 1, clausuraWinner: 3, clausuraLoser: 2, finals: { final: played(0, 1, 3, 0, 1), 'final-extra': played(0, 1, 3, 0, 0, [5, 4]) } });
    s = seasonSummary(CFG, ctx2);
    expect(s.seasonChampion.club).toBe(1);
  });

  it('D: el 1° de la Anual no es campeón → juega con el ganador de la final', () => {
    const ctx = ctxWith({ apertura1: 1, anual1: 4, clausuraWinner: 3, clausuraLoser: 2 });
    let s = seasonSummary(CFG, ctx);
    expect(s.rule).toBe('D');
    const st = computeAllTies(ctx);
    expect(st.get('final')!.status).toBe('ready');
    expect(st.get('final-anual')!.status).toBe('pending'); // falta el ganador de la final
    expect(st.get('final-extra')!.status).toBe('pending');
    const ctx2 = ctxWith({ apertura1: 1, anual1: 4, clausuraWinner: 3, clausuraLoser: 2, finals: { final: played(0, 1, 3, 3, 1) } });
    const st2 = computeAllTies(ctx2);
    expect(st2.get('final-extra')!.status).toBe('not_needed'); // el perdedor (3) no es el 1° de la Anual
    expect(st2.get('final-anual')!.status).toBe('ready');
    expect([st2.get('final-anual')!.home.club, st2.get('final-anual')!.away.club]).toEqual([4, 1]);
    const ctx3 = ctxWith({ apertura1: 1, anual1: 4, clausuraWinner: 3, clausuraLoser: 2, finals: { final: played(0, 1, 3, 3, 1), 'final-anual': played(0, 4, 1, 2, 1) } });
    s = seasonSummary(CFG, ctx3);
    expect(s.rule).toBe('D');
    expect(s.seasonChampion.club).toBe(4);
  });
});

describe('posiciones de tabla con empates', () => {
  it('empate en puntos en el 1° puesto exige desempate; el override lo resuelve', () => {
    const ctx: Context = { tables: new Map([['t', table('T', [row(1, 20, 5, 10), row(2, 20, 3, 9)])]]), ties: [], matches: new Map() };
    expect(resolveTableRank('t', 1, ctx).club).toBeNull();
    expect(resolveTableRank('t', 1, ctx).reason).toMatch(/desempate/);
    expect(resolveTableRank('t', 2, ctx).club).toBe(2); // el 2° no está en disputa de título
    ctx.tables.get('t')!.positionOverrides = { '1': 2 };
    expect(resolveTableRank('t', 1, ctx).club).toBe(2);
  });

  it('igualdad total en otra posición también pide desempate', () => {
    const ctx: Context = { tables: new Map([['t', table('T', [row(1, 20, 5, 10), row(2, 15, 2, 8), row(3, 15, 2, 8)])]]), ties: [], matches: new Map() };
    expect(resolveTableRank('t', 2, ctx).club).toBeNull();
    expect(resolveTableRank('t', 1, ctx).club).toBe(1);
  });
});
