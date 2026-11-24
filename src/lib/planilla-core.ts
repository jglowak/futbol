// Lógica pura para interpretar una planilla (acta oficial) de la LFF.
// No toca la base ni la red: recibe lo que la IA leyó de la foto y lo normaliza para revisar y guardar.
//
// Privacidad: la planilla trae cédula de cada jugador, pero NO se usa ni se guarda. La IA tiene
// instrucción de no devolverla; por las dudas, acá se descarta cualquier campo de cédula que llegue.

/** Lo que devuelve la IA al leer la foto. Campos opcionales y "sucios" (strings con espacios, etc.). */
export interface RawPlanillaPlayer {
  numero?: number | string | null;
  ficha?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  [k: string]: unknown; // tolera campos extra (ej. 'cedula'); se descartan al normalizar
}

export interface RawPlanilla {
  header?: {
    torneo?: string | null;
    categoria?: string | null;
    campo?: string | null;
    rival?: string | null;
    club?: string | null;
    fecha?: string | null; // tal como figura, ej. "14/11/2026"
    condicion?: string | null; // "local" | "visitante"
  } | null;
  guardameta_numero?: number | string | null;
  capitan_numero?: number | string | null;
  titulares?: RawPlanillaPlayer[] | null;
  suplentes?: RawPlanillaPlayer[] | null;
}

export interface PlanillaPlayer {
  shirtNumber: number | null;
  fichaOficial: string | null; // solo dígitos; null si es provisoria o ilegible
  fullName: string;
  isStarter: boolean;
  isGoalkeeper: boolean;
  isCaptain: boolean;
  provisional: boolean; // sin ficha oficial (la planilla decía "PROVISORIO" o estaba vacía)
}

export interface PlanillaHeader {
  torneo: string | null;
  categoria: string | null;
  campo: string | null;
  rival: string | null;
  club: string | null;
  fecha: string | null;
  condicion: string | null;
}

export interface NormalizedPlanilla {
  header: PlanillaHeader;
  players: PlanillaPlayer[];
  warnings: string[];
}

const clean = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v).trim();

/** Mayúscula inicial por palabra, respetando acentos. "DE BRUM" → "De Brum". */
export function titleCase(s: string): string {
  return clean(s)
    .toLocaleLowerCase('es')
    .replace(/(^|[\s'-])([\p{L}])/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('es'));
}

/** Ficha oficial: deja solo dígitos. "PROVISORIO", vacío o sin dígitos → null. */
export function normalizeFicha(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  if (/provisori/i.test(s)) return null;
  const digits = s.replace(/\D+/g, '');
  return digits.length >= 4 ? digits : null;
}

/** Número de camiseta a entero, o null. */
export function toShirt(v: unknown): number | null {
  const n = parseInt(clean(v), 10);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

function normalizePlayer(raw: RawPlanillaPlayer, isStarter: boolean, gk: number | null, cap: number | null): PlanillaPlayer | null {
  const nombre = titleCase(clean(raw?.nombre));
  const apellido = titleCase(clean(raw?.apellido));
  const fullName = `${nombre} ${apellido}`.replace(/\s+/g, ' ').trim();
  if (!fullName) return null; // fila vacía
  const shirtNumber = toShirt(raw?.numero);
  const fichaOficial = normalizeFicha(raw?.ficha);
  return {
    shirtNumber,
    fichaOficial,
    fullName,
    isStarter,
    isGoalkeeper: shirtNumber != null && shirtNumber === gk,
    isCaptain: shirtNumber != null && shirtNumber === cap,
    provisional: fichaOficial === null,
  };
}

/** Normaliza la lectura cruda de la IA a algo revisable y guardable. Descarta cédula. */
export function normalizePlanilla(raw: RawPlanilla): NormalizedPlanilla {
  const gk = toShirt(raw?.guardameta_numero);
  const cap = toShirt(raw?.capitan_numero);
  const players: PlanillaPlayer[] = [];
  for (const r of raw?.titulares ?? []) {
    const p = normalizePlayer(r, true, gk, cap);
    if (p) players.push(p);
  }
  for (const r of raw?.suplentes ?? []) {
    const p = normalizePlayer(r, false, gk, cap);
    if (p) players.push(p);
  }

  const warnings: string[] = [];
  const starters = players.filter((p) => p.isStarter);
  if (starters.length !== 11) warnings.push(`Se leyeron ${starters.length} titulares (deberían ser 11).`);
  if (!players.some((p) => p.isGoalkeeper)) warnings.push('No se pudo identificar el arquero (revisá el Nº de guardameta).');
  if (!players.some((p) => p.isCaptain)) warnings.push('No se pudo identificar el capitán (revisá el Nº de capitán).');

  const seenShirt = new Map<number, number>();
  for (const p of players) if (p.shirtNumber != null) seenShirt.set(p.shirtNumber, (seenShirt.get(p.shirtNumber) ?? 0) + 1);
  for (const [n, count] of seenShirt) if (count > 1) warnings.push(`El número ${n} aparece ${count} veces.`);

  const prov = players.filter((p) => p.provisional).length;
  if (prov) warnings.push(`${prov} jugador(es) sin ficha oficial (provisorios): confirmá el nombre antes de guardar.`);

  const h = raw?.header ?? {};
  const header: PlanillaHeader = {
    torneo: clean(h.torneo) || null,
    categoria: clean(h.categoria) || null,
    campo: clean(h.campo) || null,
    rival: titleCase(clean(h.rival)) || null,
    club: titleCase(clean(h.club)) || null,
    fecha: clean(h.fecha) || null,
    condicion: clean(h.condicion).toLowerCase() || null,
  };

  return { header, players, warnings };
}

// --- Resolución contra jugadores existentes (parte pura; las búsquedas las hace la capa de datos) ---

export interface ExistingPlayer {
  id: number;
  fullName: string;
}

export interface PlayerResolution extends PlanillaPlayer {
  action: 'link' | 'create';
  playerId: number | null;
  note: string | null;
}

/** nombre → clave comparable (sin acentos, minúsculas). */
export function nameKey(fullName: string): string {
  return fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Decide para cada jugador si se enlaza a uno existente o se crea.
 * - Con ficha: se enlaza por ficha oficial (identificador fuerte).
 * - Sin ficha (provisorio): se intenta por nombre exacto; si no, se crea y se marca para revisar.
 */
export function resolvePlayers(
  players: PlanillaPlayer[],
  lookup: { byFicha: Map<string, ExistingPlayer>; byName: Map<string, ExistingPlayer> },
): PlayerResolution[] {
  return players.map((p) => {
    if (p.fichaOficial) {
      const hit = lookup.byFicha.get(p.fichaOficial);
      if (hit) return { ...p, action: 'link', playerId: hit.id, note: null };
      return { ...p, action: 'create', playerId: null, note: null };
    }
    const hit = lookup.byName.get(nameKey(p.fullName));
    if (hit) return { ...p, action: 'link', playerId: hit.id, note: 'enlazado por nombre (sin ficha)' };
    return { ...p, action: 'create', playerId: null, note: 'provisorio: se crea sin ficha' };
  });
}
