import { describe, expect, it } from 'vitest';
import { cupTies, lffSeries, ofiSixFixture } from './templates-core';

// Tabla final real del Apertura 2026 (ids de la base): 1 Quilmes(11), 2 Nacional(10), 3 Atl.Florida(6), 4 Candil(3),
// 5 España(5), 6 River(12), 7 Boquita(2), 8 Avenida(4), 9 19 de Abril(1), 10 Vascongada(9), 11 Alianza(8), 12 Mendoza(7)
const APERTURA_ORDER = [11, 10, 6, 3, 5, 12, 2, 4, 1, 9, 8, 7];

describe('series LFF (art. 4)', () => {
  it('reproduce las series reales del Clausura 2026', () => {
    const s = lffSeries(APERTURA_ORDER);
    expect(s['Serie A']).toEqual([11, 3, 5, 2, 1, 8]); // Quilmes, Candil, España, Boquita, 19 de Abril, Alianza
    expect(s['Serie B']).toEqual([10, 6, 12, 4, 9, 7]); // Nacional, Atl. Florida, River, Avenida, Vascongada, Mendoza
  });
  it('rechaza una cantidad distinta de 12', () => {
    expect(() => lffSeries([1, 2, 3])).toThrow(/12 clubes/);
  });
});

describe('modelo OFI para seis', () => {
  // Localías del Apertura 2026 entre los clubes de cada serie (quién fue local).
  // Localías reales del Apertura 2026 (home_id-away_id → local), tomadas del seed.
  const aperturaHome = new Map<string, number>([
    ['3-6', 3], ['12-10', 12], ['9-5', 9], ['4-2', 4], ['7-8', 7], ['11-1', 11], ['5-4', 5], ['2-9', 2], ['6-12', 6], ['10-3', 10], ['7-11', 7], ['8-1', 8], ['5-7', 5], ['3-4', 3], ['10-2', 10], ['12-8', 12], ['1-6', 1], ['11-9', 11], ['5-3', 5], ['2-11', 2], ['9-7', 9], ['4-10', 4], ['12-1', 12], ['8-6', 8], ['10-9', 10], ['2-1', 2], ['11-8', 11], ['6-5', 6], ['3-12', 3], ['7-4', 7], ['8-2', 8], ['4-9', 4], ['5-12', 5], ['10-7', 10], ['6-11', 6], ['1-3', 1], ['3-7', 3], ['2-6', 2], ['11-10', 11], ['9-8', 9], ['12-4', 12], ['1-5', 1], ['2-12', 2], ['4-11', 4], ['9-3', 9], ['8-5', 8], ['7-1', 7], ['6-10', 6], ['5-2', 5], ['10-8', 10], ['6-4', 6], ['3-11', 3], ['12-7', 12], ['1-9', 1], ['9-6', 9], ['4-1', 4], ['8-3', 8], ['12-11', 12], ['2-7', 2], ['10-5', 10], ['9-12', 9], ['4-8', 4], ['3-2', 3], ['11-5', 11], ['1-10', 1], ['7-6', 7],
  ]);
  const wasHome = (a: number, b: number) => {
    const k = aperturaHome.get(`${a}-${b}`) ?? aperturaHome.get(`${b}-${a}`);
    return k === undefined ? null : k === a;
  };

  it('reproduce fecha por fecha el fixture oficial de la Serie A 2026', () => {
    const f = ofiSixFixture([11, 3, 5, 2, 1, 8], wasHome);
    const byRound = (r: number) => f.filter((m) => m.round === r).map((m) => [m.home, m.away]);
    expect(byRound(1)).toEqual([[11, 3], [2, 5], [1, 8]]); // Quilmes-Candil, Boquita-España, 19 de Abril-Alianza
    expect(byRound(2)).toEqual([[5, 11], [3, 8], [1, 2]]); // España-Quilmes, Candil-Alianza, 19 de Abril-Boquita
    expect(byRound(3)).toEqual([[11, 2], [3, 1], [5, 8]]); // Quilmes-Boquita, Candil-19 de Abril, España-Alianza
    expect(byRound(4)).toEqual([[1, 11], [3, 5], [2, 8]]); // 19 de Abril-Quilmes, Candil-España, Boquita-Alianza
    expect(byRound(5)).toEqual([[8, 11], [2, 3], [5, 1]]); // Alianza-Quilmes, Boquita-Candil, España-19 de Abril
  });

  it('reproduce la Serie B 2026', () => {
    const f = ofiSixFixture([10, 6, 12, 4, 9, 7], wasHome);
    const byRound = (r: number) => f.filter((m) => m.round === r).map((m) => [m.home, m.away]);
    expect(byRound(1)).toEqual([[10, 6], [4, 12], [7, 9]]);
    expect(byRound(5)).toEqual([[7, 10], [4, 6], [12, 9]]); // Mendoza-Nacional, Avenida-Atl. Florida, River-Vascongada
  });

  it('cada club juega una vez por fecha y contra los otros cinco', () => {
    const f = ofiSixFixture([1, 2, 3, 4, 5, 6]);
    for (let r = 1; r <= 5; r++) expect(f.filter((m) => m.round === r).flatMap((m) => [m.home, m.away]).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(f.map((m) => [m.home, m.away].sort().join('-'))).size).toBe(15);
  });
});

describe('copa eliminatoria', () => {
  it('8 clubes: cuartos, semis y final encadenadas', () => {
    const { stages, ties } = cupTies([1, 2, 3, 4, 5, 6, 7, 8], 'copa');
    expect(stages).toEqual(['Cuartos de final', 'Semifinales', 'Final']);
    expect(ties).toHaveLength(7);
    expect(ties[0]).toMatchObject({ code: 'copa-r1-1', home: { type: 'club', club: 1 }, away: { type: 'club', club: 2 } });
    expect(ties[4]).toMatchObject({ label: 'Semifinal 1', home: { type: 'tie_winner', tie: 'copa-r1-1' }, away: { type: 'tie_winner', tie: 'copa-r1-2' } });
    expect(ties[6]).toMatchObject({ label: 'Final', home: { type: 'tie_winner', tie: 'copa-r2-1' }, away: { type: 'tie_winner', tie: 'copa-r2-2' } });
  });
  it('rechaza cantidades que no son potencia de 2', () => {
    expect(() => cupTies([1, 2, 3], 'c')).toThrow(/2, 4, 8/);
  });
});
