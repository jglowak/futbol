// Motor de fases: resuelve quién juega cada llave y si la llave se juega.
// Módulo puro (sin base de datos) para poder probar los casos del reglamento.

import type { StandingRow } from './standings';

// ---- Referencias a participantes ----
export type Ref =
  | { type: 'table_rank'; table: string; rank: number } // "1° de la tabla X"
  | { type: 'tie_winner'; tie: string } // "ganador de la llave X"
  | { type: 'tie_loser'; tie: string } // "perdedor de la llave X"
  | { type: 'club'; club: number }; // club fijo

export type Condition =
  | { type: 'distinct'; a: Ref; b: Ref } // se juega si a ≠ b
  | { type: 'equals'; a: Ref; b: Ref } // se juega si a = b
  | { type: 'not_in'; ref: Ref; set: Ref[] }; // se juega si ref no está en set

export interface TieDef {
  code: string;
  label: string;
  home_ref: Ref;
  away_ref: Ref;
  condition: Condition | null;
  neutral: boolean;
  home_override_club_id: number | null;
  away_override_club_id: number | null;
  match_id: number | null;
}

export interface TieMatch {
  id: number;
  status: string;
  home_club_id: number;
  away_club_id: number;
  home_goals: number | null;
  away_goals: number | null;
  home_pens: number | null;
  away_pens: number | null;
}

export interface TableInfo {
  rows: StandingRow[];
  /** Partidos pendientes de la(s) etapa(s) fuente: si hay, la tabla no está cerrada. */
  pending: number;
  /** {"1": clubId}: desempate manual para una posición. */
  positionOverrides: Record<string, number>;
  name: string;
}

export interface Context {
  tables: Map<string, TableInfo>;
  ties: TieDef[];
  matches: Map<number, TieMatch>;
}

export type Resolved = { club: number | null; reason: string | null };

export interface TieState {
  code: string;
  label: string;
  neutral: boolean;
  home: Resolved;
  away: Resolved;
  homeLabel: string; // texto para mostrar cuando no está resuelto ("1° Serie A")
  awayLabel: string;
  condition: Condition | null;
  conditionMet: boolean | null; // null = todavía no se sabe
  status: 'pending' | 'not_needed' | 'ready' | 'scheduled' | 'live' | 'finished';
  match: TieMatch | null;
  winner: number | null;
  loser: number | null;
  needsDecision: boolean; // partido terminado empatado sin penales
  note: string | null;
}

// ---- Resolución ----

export function describeRef(ref: Ref, ctx: Context): string {
  switch (ref.type) {
    case 'table_rank': {
      const t = ctx.tables.get(ref.table);
      return `${ref.rank}° ${t?.name ?? ref.table}`;
    }
    case 'tie_winner': {
      const t = ctx.ties.find((x) => x.code === ref.tie);
      return `Ganador ${t?.label ?? ref.tie}`;
    }
    case 'tie_loser': {
      const t = ctx.ties.find((x) => x.code === ref.tie);
      return `Perdedor ${t?.label ?? ref.tie}`;
    }
    case 'club':
      return `Club #${ref.club}`;
  }
}

/** Resultado de un partido de llave: ganador/perdedor por goles y, si empatan, por penales. */
export function decideMatch(m: TieMatch | null): { winner: number | null; loser: number | null; needsDecision: boolean } {
  if (!m || m.status !== 'finished' || m.home_goals === null || m.away_goals === null) return { winner: null, loser: null, needsDecision: false };
  if (m.home_goals !== m.away_goals) {
    const homeWins = m.home_goals > m.away_goals;
    return { winner: homeWins ? m.home_club_id : m.away_club_id, loser: homeWins ? m.away_club_id : m.home_club_id, needsDecision: false };
  }
  if (m.home_pens !== null && m.away_pens !== null && m.home_pens !== m.away_pens) {
    const homeWins = m.home_pens > m.away_pens;
    return { winner: homeWins ? m.home_club_id : m.away_club_id, loser: homeWins ? m.away_club_id : m.home_club_id, needsDecision: false };
  }
  return { winner: null, loser: null, needsDecision: true };
}

/**
 * Posición de una tabla. Devuelve null si la tabla no está cerrada o si hay
 * igualdad que requiere desempate (partido extra, fair play o sorteo) sin override.
 */
export function resolveTableRank(table: string, rank: number, ctx: Context): Resolved {
  const t = ctx.tables.get(table);
  if (!t) return { club: null, reason: `Tabla ${table} no encontrada` };
  const override = t.positionOverrides[String(rank)];
  if (override) return { club: override, reason: null };
  if (t.pending > 0) return { club: null, reason: `${t.name}: faltan ${t.pending} partido${t.pending === 1 ? '' : 's'}` };
  const row = t.rows[rank - 1];
  if (!row) return { club: null, reason: `${t.name}: no hay posición ${rank}` };
  // Igualdad con el vecino de arriba o de abajo en todos los criterios → necesita desempate.
  const same = (a: StandingRow, b: StandingRow) =>
    a.points === b.points && a.goalDifference === b.goalDifference && a.goalsFor === b.goalsFor;
  const up = t.rows[rank - 2];
  const down = t.rows[rank];
  if ((up && same(up, row)) || (down && same(row, down))) {
    return { club: null, reason: `${t.name}: igualdad total en la posición ${rank}, hace falta desempate (fair play, sorteo o partido extra)` };
  }
  // Igualdad solo en puntos en el 1° puesto: el reglamento exige partido de desempate (art. 12).
  if (rank === 1 && down && down.points === row.points) {
    return { club: null, reason: `${t.name}: empate en puntos en el 1° puesto, corresponde partido de desempate (art. 12)` };
  }
  return { club: row.clubId, reason: null };
}

export function resolveRef(ref: Ref, ctx: Context, depth = 0): Resolved {
  if (depth > 10) return { club: null, reason: 'Referencia circular' };
  switch (ref.type) {
    case 'club':
      return { club: ref.club, reason: null };
    case 'table_rank':
      return resolveTableRank(ref.table, ref.rank, ctx);
    case 'tie_winner':
    case 'tie_loser': {
      const tie = ctx.ties.find((t) => t.code === ref.tie);
      if (!tie) return { club: null, reason: `Llave ${ref.tie} no encontrada` };
      const st = computeTie(tie, ctx, depth + 1);
      if (st.status === 'not_needed') return { club: null, reason: `${tie.label} no se juega` };
      const club = ref.type === 'tie_winner' ? st.winner : st.loser;
      if (club) return { club, reason: null };
      return { club: null, reason: st.needsDecision ? `${tie.label}: empate sin definir` : `${tie.label} pendiente` };
    }
  }
}

export function evalCondition(c: Condition | null, ctx: Context, depth = 0): boolean | null {
  if (!c) return true;
  switch (c.type) {
    case 'distinct':
    case 'equals': {
      const a = resolveRef(c.a, ctx, depth + 1).club;
      const b = resolveRef(c.b, ctx, depth + 1).club;
      if (a === null || b === null) return null;
      return c.type === 'distinct' ? a !== b : a === b;
    }
    case 'not_in': {
      const r = resolveRef(c.ref, ctx, depth + 1).club;
      if (r === null) return null;
      const set = c.set.map((x) => resolveRef(x, ctx, depth + 1).club);
      if (set.includes(r)) return false; // ya está: no se juega
      if (set.some((x) => x === null)) return null; // falta saber alguno
      return true;
    }
  }
}

export function computeTie(tie: TieDef, ctx: Context, depth = 0): TieState {
  const match = tie.match_id ? (ctx.matches.get(tie.match_id) ?? null) : null;
  const conditionMet = evalCondition(tie.condition, ctx, depth);

  // Participantes: override manual > partido ya creado > referencia.
  const home: Resolved = tie.home_override_club_id
    ? { club: tie.home_override_club_id, reason: null }
    : match
      ? { club: match.home_club_id, reason: null }
      : resolveRef(tie.home_ref, ctx, depth + 1);
  const away: Resolved = tie.away_override_club_id
    ? { club: tie.away_override_club_id, reason: null }
    : match
      ? { club: match.away_club_id, reason: null }
      : resolveRef(tie.away_ref, ctx, depth + 1);

  const decision = decideMatch(match);
  let status: TieState['status'];
  if (conditionMet === false && !match) status = 'not_needed';
  else if (match) status = match.status === 'finished' ? 'finished' : match.status === 'live' ? 'live' : 'scheduled';
  else if (home.club !== null && away.club !== null && conditionMet === true) status = 'ready';
  else status = 'pending';

  return {
    code: tie.code,
    label: tie.label,
    neutral: tie.neutral,
    home,
    away,
    homeLabel: describeRef(tie.home_ref, ctx),
    awayLabel: describeRef(tie.away_ref, ctx),
    condition: tie.condition,
    conditionMet,
    status,
    match,
    winner: decision.winner,
    loser: decision.loser,
    needsDecision: decision.needsDecision,
    note: null,
  };
}

export function computeAllTies(ctx: Context): Map<string, TieState> {
  const out = new Map<string, TieState>();
  for (const t of ctx.ties) out.set(t.code, computeTie(t, ctx));
  return out;
}

// ---- Definición de temporada (LFF, art. 5) ----

export interface SeasonDefinitionConfig {
  apertura_table: string;
  clausura_final: string;
  anual_table: string;
  final: string;
  final_extra: string;
  final_anual: string;
}

export interface SeasonSummary {
  aperturaChampion: Resolved;
  clausuraChampion: Resolved;
  anualLeader: Resolved;
  /** A, B, C o D según el artículo 5; null si todavía no se sabe. */
  rule: 'A' | 'B' | 'C' | 'D' | null;
  seasonChampion: Resolved;
  explanation: string;
}

export function seasonSummary(cfg: SeasonDefinitionConfig, ctx: Context): SeasonSummary {
  const aperturaChampion = resolveRef({ type: 'table_rank', table: cfg.apertura_table, rank: 1 }, ctx);
  const clausuraChampion = resolveRef({ type: 'tie_winner', tie: cfg.clausura_final }, ctx);
  const anualLeader = resolveRef({ type: 'table_rank', table: cfg.anual_table, rank: 1 }, ctx);
  const ties = computeAllTies(ctx);
  const final = ties.get(cfg.final);
  const extra = ties.get(cfg.final_extra);
  const anualFinal = ties.get(cfg.final_anual);

  const pendingBase = (): SeasonSummary => ({
    aperturaChampion, clausuraChampion, anualLeader, rule: null,
    seasonChampion: { club: null, reason: 'Faltan definir los campeones del Apertura y del Clausura' },
    explanation: 'La definición de la temporada se arma cuando terminen el Apertura y el Clausura.',
  });

  if (aperturaChampion.club === null || clausuraChampion.club === null) return pendingBase();

  if (aperturaChampion.club === clausuraChampion.club) {
    return {
      aperturaChampion, clausuraChampion, anualLeader, rule: 'A',
      seasonChampion: { club: aperturaChampion.club, reason: null },
      explanation: 'El mismo club ganó el Apertura y el Clausura: es campeón de la temporada (art. 5 A).',
    };
  }

  if (anualLeader.club === null) {
    return { aperturaChampion, clausuraChampion, anualLeader, rule: null, seasonChampion: { club: null, reason: anualLeader.reason }, explanation: 'Falta definir el 1° de la Tabla Anual para saber si hay final extra.' };
  }

  const anualIsChampion = anualLeader.club === aperturaChampion.club || anualLeader.club === clausuraChampion.club;
  if (!anualIsChampion) {
    // D: el 1° de la Anual juega con el ganador de la final entre campeones.
    const w = anualFinal?.winner ?? null;
    return {
      aperturaChampion, clausuraChampion, anualLeader, rule: 'D',
      seasonChampion: { club: w, reason: w ? null : (final?.winner ? 'Falta jugar la final con el 1° de la Anual' : 'Falta jugar la final entre campeones') },
      explanation: 'Campeones distintos y el 1° de la Anual no es ninguno: el ganador de la final entre campeones juega una final más contra el 1° de la Anual (art. 5 D).',
    };
  }

  // B o C: final entre campeones; si pierde el 1° de la Anual, final extra.
  if (!final?.winner) {
    return { aperturaChampion, clausuraChampion, anualLeader, rule: 'B', seasonChampion: { club: null, reason: final?.needsDecision ? 'La final terminó empatada: falta la definición' : 'Falta jugar la final entre campeones' }, explanation: 'Campeones distintos: juegan la final de la temporada (art. 5 B). Si pierde el 1° de la Anual, tiene derecho a una final extra (art. 5 C).' };
  }
  if (final.loser === anualLeader.club) {
    const w = extra?.winner ?? null;
    return {
      aperturaChampion, clausuraChampion, anualLeader, rule: 'C',
      seasonChampion: { club: w, reason: w ? null : 'Falta jugar la final extra' },
      explanation: 'El 1° de la Anual perdió la final y tiene derecho a una final extra (art. 5 C).',
    };
  }
  return {
    aperturaChampion, clausuraChampion, anualLeader, rule: 'B',
    seasonChampion: { club: final.winner, reason: null },
    explanation: 'El 1° de la Anual ganó la final entre campeones: es campeón de la temporada (art. 5 B).',
  };
}
