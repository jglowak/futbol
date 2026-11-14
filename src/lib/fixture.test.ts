import { describe, expect, it } from 'vitest';
import { roundRobin } from './fixture';

const key = (a: number, b: number) => [a, b].sort((x, y) => x - y).join('-');

describe('roundRobin', () => {
  it('6 equipos, una rueda: 5 fechas, 15 cruces únicos, cada uno juega una vez por fecha', () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const p = roundRobin(ids);
    expect(p).toHaveLength(15);
    expect(new Set(p.map((x) => key(x.home, x.away))).size).toBe(15);
    for (let r = 1; r <= 5; r++) {
      const inRound = p.filter((x) => x.round === r).flatMap((x) => [x.home, x.away]);
      expect([...inRound].sort()).toEqual(ids);
    }
  });

  it('12 equipos, ida y vuelta: 22 fechas y 132 partidos, vuelta con localía invertida', () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const p = roundRobin(ids, 2);
    expect(p).toHaveLength(132);
    expect(Math.max(...p.map((x) => x.round))).toBe(22);
    const ida = p.filter((x) => x.round <= 11);
    for (const m of ida) {
      expect(p.some((x) => x.round === m.round + 11 && x.home === m.away && x.away === m.home)).toBe(true);
    }
  });

  it('cantidad impar: uno libre por fecha', () => {
    const p = roundRobin([1, 2, 3, 4, 5]);
    expect(p).toHaveLength(10);
    expect(Math.max(...p.map((x) => x.round))).toBe(5);
    expect(p.filter((x) => x.round === 1)).toHaveLength(2);
  });

  it('localía razonablemente repartida', () => {
    const p = roundRobin([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const home = p.filter((x) => x.home === id).length;
      expect(home).toBeGreaterThanOrEqual(3);
      expect(home).toBeLessThanOrEqual(4);
    }
  });
});
