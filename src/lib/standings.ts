// Cálculo de tablas de posiciones. Módulo puro (sin dependencias de Cloudflare)
// para poder probarlo con tests automáticos.

export type Tiebreaker =
  | 'goal_difference'
  | 'goals_for'
  | 'goals_against' // menos goles en contra es mejor
  | 'wins'
  | 'name';

export interface StandingsConfig {
  points?: { win?: number; draw?: number; loss?: number };
  /** Criterios de desempate, en orden. Por defecto: diferencia de gol, goles a favor. */
  tiebreakers?: Tiebreaker[];
}

export interface MatchInput {
  homeClubId: number;
  awayClubId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  /** Se cuentan los 'finished'; los 'live' solo si se pide `includeLive`. */
  status: string;
}

export interface AdjustmentInput {
  clubId: number;
  points?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  played?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  reason: string;
}

export interface ClubInput {
  id: number;
  name: string;
  shortName?: string | null;
  crestUrl?: string | null;
  slug?: string;
}

export interface StandingRow {
  position: number;
  clubId: number;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
  slug: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Puntos aportados por ajustes manuales (ya incluidos en `points`). */
  pointsAdjustment: number;
  adjustmentReasons: string[];
  /** El club tiene un partido en juego contado en esta tabla (solo con includeLive). */
  live: boolean;
  /** Puestos que ganó (+) o perdió (−) respecto de la tabla oficial. Lo completa quien compara. */
  positionChange: number;
}

export interface StandingsOptions {
  /** Contar también los partidos en juego, con el resultado parcial. */
  includeLive?: boolean;
}

const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };
const DEFAULT_TIEBREAKERS: Tiebreaker[] = ['goal_difference', 'goals_for'];

export function computeStandings(
  clubs: ClubInput[],
  matches: MatchInput[],
  adjustments: AdjustmentInput[] = [],
  config: StandingsConfig = {},
  options: StandingsOptions = {},
): StandingRow[] {
  const pts = { ...DEFAULT_POINTS, ...(config.points ?? {}) };
  const tiebreakers = config.tiebreakers ?? DEFAULT_TIEBREAKERS;

  const rows = new Map<number, StandingRow>();
  for (const c of clubs) {
    rows.set(c.id, {
      position: 0,
      clubId: c.id,
      name: c.name,
      shortName: c.shortName ?? null,
      crestUrl: c.crestUrl ?? null,
      slug: c.slug ?? null,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      pointsAdjustment: 0,
      adjustmentReasons: [],
      live: false,
      positionChange: 0,
    });
  }

  for (const m of matches) {
    const isLive = m.status === 'live';
    if (m.status !== 'finished' && !(isLive && options.includeLive)) continue;
    if (m.homeGoals === null || m.awayGoals === null) continue;
    const home = rows.get(m.homeClubId);
    const away = rows.get(m.awayClubId);
    // Un partido solo cuenta si ambos clubes participan de esta tabla.
    if (!home || !away) continue;
    if (isLive) { home.live = true; away.live = true; }

    home.played++;
    away.played++;
    home.goalsFor += m.homeGoals;
    home.goalsAgainst += m.awayGoals;
    away.goalsFor += m.awayGoals;
    away.goalsAgainst += m.homeGoals;

    if (m.homeGoals > m.awayGoals) {
      home.won++;
      away.lost++;
      home.points += pts.win;
      away.points += pts.loss;
    } else if (m.homeGoals < m.awayGoals) {
      away.won++;
      home.lost++;
      away.points += pts.win;
      home.points += pts.loss;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += pts.draw;
      away.points += pts.draw;
    }
  }

  for (const a of adjustments) {
    const row = rows.get(a.clubId);
    if (!row) continue;
    row.points += a.points ?? 0;
    row.pointsAdjustment += a.points ?? 0;
    row.goalsFor += a.goalsFor ?? 0;
    row.goalsAgainst += a.goalsAgainst ?? 0;
    row.played += a.played ?? 0;
    row.won += a.won ?? 0;
    row.drawn += a.drawn ?? 0;
    row.lost += a.lost ?? 0;
    row.adjustmentReasons.push(a.reason);
  }

  const list = [...rows.values()];
  for (const r of list) r.goalDifference = r.goalsFor - r.goalsAgainst;

  const compare = (a: StandingRow, b: StandingRow): number => {
    if (b.points !== a.points) return b.points - a.points;
    for (const t of tiebreakers) {
      let d = 0;
      switch (t) {
        case 'goal_difference':
          d = b.goalDifference - a.goalDifference;
          break;
        case 'goals_for':
          d = b.goalsFor - a.goalsFor;
          break;
        case 'goals_against':
          d = a.goalsAgainst - b.goalsAgainst;
          break;
        case 'wins':
          d = b.won - a.won;
          break;
        case 'name':
          d = a.name.localeCompare(b.name, 'es');
          break;
      }
      if (d !== 0) return d;
    }
    // Orden estable y determinístico si todo empata.
    return a.name.localeCompare(b.name, 'es');
  };

  list.sort(compare);
  list.forEach((r, i) => (r.position = i + 1));
  return list;
}
