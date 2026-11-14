// Generador de fixture "todos contra todos" (método del círculo).
// Puro, sin base de datos, para poder probarlo.

export interface Pairing {
  round: number; // 1-based
  home: number;
  away: number;
}

/**
 * Devuelve los cruces de una rueda (y la segunda invertida si legs = 2).
 * Con cantidad impar de equipos, cada fecha uno queda libre.
 * La localía se alterna para que ningún equipo juegue siempre de local.
 */
export function roundRobin(clubIds: number[], legs: 1 | 2 = 1): Pairing[] {
  const ids = [...clubIds];
  if (ids.length < 2) return [];
  const BYE = -1;
  if (ids.length % 2 === 1) ids.push(BYE);
  const n = ids.length;
  const rounds = n - 1;
  const out: Pairing[] = [];
  const rotating = ids.slice(1);
  const homeCount = new Map<number, number>(ids.map((id) => [id, 0]));
  for (let r = 0; r < rounds; r++) {
    const lineup = [ids[0], ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      // Localía: el que menos veces fue local hasta ahora (empate: alterna por fecha).
      const ha = homeCount.get(a)!, hb = homeCount.get(b)!;
      const aHome = ha !== hb ? ha < hb : r % 2 === 0;
      const home = aHome ? a : b, away = aHome ? b : a;
      homeCount.set(home, homeCount.get(home)! + 1);
      out.push({ round: r + 1, home, away });
    }
    rotating.unshift(rotating.pop()!);
  }
  if (legs === 2) {
    const first = [...out];
    for (const p of first) out.push({ round: p.round + rounds, home: p.away, away: p.home });
  }
  return out;
}
