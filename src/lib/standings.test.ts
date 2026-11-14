import { describe, expect, it } from 'vitest';
import { computeStandings, type MatchInput } from './standings';

const clubs = [
  { id: 1, name: 'Alfa' },
  { id: 2, name: 'Beta' },
  { id: 3, name: 'Gama' },
];

const fin = (h: number, a: number, hg: number, ag: number): MatchInput => ({
  homeClubId: h,
  awayClubId: a,
  homeGoals: hg,
  awayGoals: ag,
  status: 'finished',
});

describe('computeStandings', () => {
  it('suma 3/1/0 puntos y goles', () => {
    const t = computeStandings(clubs, [fin(1, 2, 2, 0), fin(2, 3, 1, 1)]);
    const alfa = t.find((r) => r.clubId === 1)!;
    expect(alfa).toMatchObject({ played: 1, won: 1, points: 3, goalsFor: 2, goalDifference: 2 });
    const beta = t.find((r) => r.clubId === 2)!;
    expect(beta).toMatchObject({ played: 2, drawn: 1, lost: 1, points: 1 });
  });

  it('ignora partidos no finalizados o sin marcador', () => {
    const t = computeStandings(clubs, [
      { ...fin(1, 2, 5, 0), status: 'live' },
      { ...fin(1, 3, 0, 0), homeGoals: null, awayGoals: null },
    ]);
    expect(t.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it('con igual puntos y diferencia de gol, desempata por goles a favor', () => {
    const c = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
      { id: 4, name: 'D' },
    ];
    const t = computeStandings(c, [
      fin(2, 4, 1, 0), // B: 3 pts, +1, GF 1
      fin(1, 3, 3, 2), // A: 3 pts, +1, GF 3
    ]);
    expect(t[0].name).toBe('A');
    expect(t[1].name).toBe('B');
  });

  it('ordena primero por puntos', () => {
    const t = computeStandings(clubs, [
      fin(1, 3, 3, 0), // Alfa gana
      fin(2, 3, 5, 3), // Beta gana
      fin(1, 2, 0, 1), // Beta le gana a Alfa
      fin(3, 1, 0, 0), // empate
    ]);
    // Alfa 4 pts, Beta 6 pts, Gama 1 pt
    expect(t.map((r) => r.name)).toEqual(['Beta', 'Alfa', 'Gama']);
  });

  it('usa diferencia de gol antes que goles a favor', () => {
    const c = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
      { id: 4, name: 'D' },
    ];
    const t = computeStandings(c, [
      fin(1, 3, 1, 0), // A +1, GF 1
      fin(2, 4, 4, 2), // B +2, GF 4
    ]);
    // A y B con 3 pts; B tiene mejor diferencia
    expect(t[0].name).toBe('B');
    expect(t[1].name).toBe('A');
  });

  it('aplica ajustes manuales con motivo (puntos y goles iniciales)', () => {
    const t = computeStandings(
      clubs,
      [fin(1, 2, 1, 0)],
      [
        { clubId: 2, points: 5, goalsFor: 4, goalsAgainst: 1, played: 2, reason: 'Arrastre del Apertura' },
        { clubId: 1, points: -3, reason: 'Sanción' },
      ],
    );
    const beta = t.find((r) => r.clubId === 2)!;
    expect(beta).toMatchObject({ points: 5, goalsFor: 4, goalsAgainst: 2, played: 3, pointsAdjustment: 5 }); // GA: 1 del ajuste + 1 del partido perdido
    expect(beta.adjustmentReasons).toEqual(['Arrastre del Apertura']);
    const alfa = t.find((r) => r.clubId === 1)!;
    expect(alfa.points).toBe(0); // 3 por ganar - 3 de sanción
  });

  it('tabla acumulada: suma partidos de varias etapas', () => {
    const apertura = [fin(1, 2, 1, 0)];
    const clausura = [fin(2, 1, 0, 2), fin(1, 3, 1, 1)];
    const t = computeStandings(clubs, [...apertura, ...clausura]);
    const alfa = t.find((r) => r.clubId === 1)!;
    expect(alfa).toMatchObject({ played: 3, won: 2, drawn: 1, points: 7, goalsFor: 4, goalsAgainst: 1 });
    expect(t[0].name).toBe('Alfa');
  });

  it('respeta reglas de puntos y desempates configurables', () => {
    const t = computeStandings(clubs, [fin(1, 2, 1, 0)], [], {
      points: { win: 2, draw: 1, loss: 0 },
    });
    expect(t.find((r) => r.clubId === 1)!.points).toBe(2);
  });

  it('ignora partidos de clubes que no participan de la tabla', () => {
    const t = computeStandings(clubs, [fin(1, 99, 3, 0)]);
    expect(t.find((r) => r.clubId === 1)!.played).toBe(0);
  });

  it('empate total: orden alfabético estable', () => {
    const t = computeStandings(clubs, []);
    expect(t.map((r) => r.name)).toEqual(['Alfa', 'Beta', 'Gama']);
    expect(t.map((r) => r.position)).toEqual([1, 2, 3]);
  });
});
