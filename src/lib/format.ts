const TZ = 'America/Montevideo';

export function formatKickoff(iso: string | null): string {
  if (!iso) return 'A confirmar';
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function scoreText(m: {
  status: string;
  home_goals: number | null;
  away_goals: number | null;
}): string {
  if (m.status === 'scheduled' || m.status === 'postponed' || m.status === 'cancelled') return 'vs';
  if (m.home_goals === null || m.away_goals === null) return 'vs';
  return `${m.home_goals} - ${m.away_goals}`;
}

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Programado',
  live: 'En vivo',
  finished: 'Final',
  postponed: 'Postergado',
  cancelled: 'Suspendido',
};

/** "Finalizado · sáb 14/11 18:40" (hora de Uruguay). */
export function finishedLabel(finishedAt: string | null): string {
  if (!finishedAt) return 'Finalizado';
  const d = new Date(finishedAt.endsWith('Z') || finishedAt.includes('+') ? finishedAt : finishedAt + 'Z');
  const f = new Intl.DateTimeFormat('es-UY', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  return `Finalizado · ${f}`;
}

export function pensText(m: { home_pens: number | null; away_pens: number | null }): string {
  return m.home_pens !== null && m.away_pens !== null ? `(${m.home_pens}-${m.away_pens} pen.)` : '';
}
