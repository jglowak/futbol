export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Fecha dd-mm-yyyy en hora de Uruguay (UTC-3, sin horario de verano). */
export function uyDateParts(iso: string): { dd: string; mm: string; yyyy: string } {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return {
    dd: String(d.getUTCDate()).padStart(2, '0'),
    mm: String(d.getUTCMonth() + 1).padStart(2, '0'),
    yyyy: String(d.getUTCFullYear()),
  };
}

export function matchSlugBase(home: string, away: string, kickoffIso: string | null): string {
  const base = `${slugify(home)}-vs-${slugify(away)}`;
  if (!kickoffIso) return base;
  const { dd, mm, yyyy } = uyDateParts(kickoffIso);
  return `${base}-${dd}-${mm}-${yyyy}`;
}
