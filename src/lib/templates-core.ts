// Plantillas de torneo: lógica pura, sin base de datos.
// - Series del Clausura LFF a partir de la tabla final del Apertura (art. 4).
// - Fixture "modelo OFI para seis": deducido del fixture oficial del Clausura 2026.
// - Llaves de una copa por eliminación directa.

/** Art. 4: Serie A = 1°, 4°, 5°, 7°, 9°, 11°; Serie B = 2°, 3°, 6°, 8°, 10°, 12° (posiciones del Apertura). */
export const LFF_SERIES_RANKS: Record<'Serie A' | 'Serie B', number[]> = {
  'Serie A': [1, 4, 5, 7, 9, 11],
  'Serie B': [2, 3, 6, 8, 10, 12],
};

/** @param aperturaOrder clubes ordenados por posición final del Apertura (índice 0 = 1°). */
export function lffSeries(aperturaOrder: number[]): Record<'Serie A' | 'Serie B', number[]> {
  if (aperturaOrder.length !== 12) throw new Error(`El reglamento LFF prevé 12 clubes; hay ${aperturaOrder.length}`);
  const pick = (ranks: number[]) => ranks.map((r) => aperturaOrder[r - 1]);
  return { 'Serie A': pick(LFF_SERIES_RANKS['Serie A']), 'Serie B': pick(LFF_SERIES_RANKS['Serie B']) };
}

/**
 * Modelo OFI para seis: cruces por fecha entre los números 1..6 de la serie
 * (el número de cada club = su orden de posición del Apertura dentro de la serie).
 * Deducido del fixture oficial LFF Clausura 2026; la localía se decide aparte
 * (invertida respecto del cruce del Apertura).
 */
export const OFI_SIX_MODEL: [number, number][][] = [
  [[1, 2], [3, 4], [5, 6]],
  [[1, 3], [2, 6], [4, 5]],
  [[1, 4], [2, 5], [3, 6]],
  [[1, 5], [2, 3], [4, 6]],
  [[1, 6], [2, 4], [3, 5]],
];

export interface SeriesMatch {
  round: number;
  home: number;
  away: number;
}

/**
 * Fixture de una serie de 6 según el modelo OFI.
 * @param numbered clubes de la serie en orden de número (índice 0 = número 1).
 * @param wasHomeInApertura (a, b) → true si `a` fue local contra `b` en el Apertura; la localía se invierte.
 *        Si no se conoce el cruce, el número menor es local.
 */
export function ofiSixFixture(numbered: number[], wasHomeInApertura?: (a: number, b: number) => boolean | null): SeriesMatch[] {
  if (numbered.length !== 6) throw new Error(`El modelo OFI para seis necesita 6 clubes; hay ${numbered.length}`);
  const out: SeriesMatch[] = [];
  OFI_SIX_MODEL.forEach((pairs, i) => {
    for (const [x, y] of pairs) {
      const a = numbered[x - 1];
      const b = numbered[y - 1];
      const aWasHome = wasHomeInApertura ? wasHomeInApertura(a, b) : null;
      // Invertir: quien fue local en el Apertura ahora es visitante.
      const home = aWasHome === null ? a : aWasHome ? b : a;
      const away = home === a ? b : a;
      out.push({ round: i + 1, home, away });
    }
  });
  return out;
}

// ---- Copa por eliminación directa ----

export interface CupTieDef {
  stageIndex: number; // 0 = primera ronda
  stageName: string;
  code: string;
  label: string;
  home: { type: 'club'; club: number } | { type: 'tie_winner'; tie: string };
  away: { type: 'club'; club: number } | { type: 'tie_winner'; tie: string };
}

const ROUND_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semifinales', 8: 'Cuartos de final', 16: 'Octavos de final', 32: 'Dieciseisavos de final' };

/**
 * Llaves de una copa con N clubes (N potencia de 2, 2..32), emparejados 1-2, 3-4, …
 * El orden de `clubs` es el de siembra que decide los cruces.
 */
export function cupTies(clubs: number[], codePrefix: string): { stages: string[]; ties: CupTieDef[] } {
  const n = clubs.length;
  if (n < 2 || n > 32 || (n & (n - 1)) !== 0) throw new Error(`Una copa necesita 2, 4, 8, 16 o 32 clubes; hay ${n}`);
  const stages: string[] = [];
  const ties: CupTieDef[] = [];
  let size = n;
  let stageIndex = 0;
  let prevCodes: string[] = [];
  while (size >= 2) {
    const stageName = ROUND_NAMES[size] ?? `Ronda de ${size}`;
    stages.push(stageName);
    const count = size / 2;
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = `${codePrefix}-r${stageIndex + 1}-${i + 1}`;
      const label = size === 2 ? 'Final' : size === 4 ? `Semifinal ${i + 1}` : `${stageName.replace(/ de final$/, '')} ${i + 1}`;
      const home = stageIndex === 0 ? ({ type: 'club', club: clubs[2 * i] } as const) : ({ type: 'tie_winner', tie: prevCodes[2 * i] } as const);
      const away = stageIndex === 0 ? ({ type: 'club', club: clubs[2 * i + 1] } as const) : ({ type: 'tie_winner', tie: prevCodes[2 * i + 1] } as const);
      ties.push({ stageIndex, stageName, code, label, home, away });
      codes.push(code);
    }
    prevCodes = codes;
    size = count;
    stageIndex++;
  }
  return { stages, ties };
}
