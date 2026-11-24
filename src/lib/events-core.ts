// Parte pura de los eventos del partido (gol, tarjeta, cambio): mapeos, íconos y textos.
// Sin dependencias del Worker, para poder testearlo.

export type EventDbType = 'goal' | 'penalty_goal' | 'own_goal' | 'yellow_card' | 'red_card' | 'sub';

/** Opciones del selector del panel → tipo que se guarda en la base. */
export const EVENT_UI: Record<string, { db: EventDbType; label: string; icon: string; needsOut?: boolean }> = {
  gol: { db: 'goal', label: 'Gol', icon: '⚽' },
  penal: { db: 'penalty_goal', label: 'Gol de penal', icon: '⚽' },
  contra: { db: 'own_goal', label: 'Gol en contra', icon: '🔴' },
  amarilla: { db: 'yellow_card', label: 'Amarilla', icon: '🟨' },
  roja: { db: 'red_card', label: 'Roja', icon: '🟥' },
  cambio: { db: 'sub', label: 'Cambio', icon: '🔁', needsOut: true },
};

const BY_DB: Record<EventDbType, { label: string; icon: string }> = {
  goal: { label: 'Gol', icon: '⚽' },
  penalty_goal: { label: 'Gol de penal', icon: '⚽' },
  own_goal: { label: 'Gol en contra', icon: '🔴' },
  yellow_card: { label: 'Amarilla', icon: '🟨' },
  red_card: { label: 'Roja', icon: '🟥' },
  sub: { label: 'Cambio', icon: '🔁' },
};

export function dbTypeFromUi(key: string): EventDbType | null {
  return EVENT_UI[key]?.db ?? null;
}

export function isGoalType(t: EventDbType): boolean {
  return t === 'goal' || t === 'penalty_goal' || t === 'own_goal';
}

export function eventIcon(t: EventDbType): string {
  return BY_DB[t]?.icon ?? '';
}

export function eventLabel(t: EventDbType): string {
  return BY_DB[t]?.label ?? t;
}

/** Detalle del evento con los jugadores: lo que va al lado del ícono en el feed. */
export function eventDetail(ev: { type: EventDbType; playerName: string | null; relatedName: string | null }): string {
  const who = ev.playerName ?? 'jugador';
  switch (ev.type) {
    case 'goal':
    case 'penalty_goal':
    case 'own_goal':
      return who;
    case 'yellow_card':
    case 'red_card':
      return who;
    case 'sub':
      return ev.relatedName ? `Entra ${who}, sale ${ev.relatedName}` : `Entra ${who}`;
    default:
      return who;
  }
}
