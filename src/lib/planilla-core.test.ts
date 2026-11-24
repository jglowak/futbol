import { describe, expect, it } from 'vitest';
import {
  normalizeFicha,
  normalizePlanilla,
  nameKey,
  resolvePlayers,
  titleCase,
  toShirt,
  type ExistingPlayer,
  type RawPlanilla,
} from './planilla-core';

describe('normalizeFicha', () => {
  it('deja solo dígitos', () => {
    expect(normalizeFicha('2735285')).toBe('2735285');
    expect(normalizeFicha('5.578.015-0')).toBe('55780150'); // por si llega con puntos
  });
  it('provisorio o vacío → null', () => {
    expect(normalizeFicha('PROVISORIO')).toBeNull();
    expect(normalizeFicha('')).toBeNull();
    expect(normalizeFicha('  ')).toBeNull();
    expect(normalizeFicha('ab')).toBeNull();
  });
});

describe('titleCase y toShirt', () => {
  it('capitaliza respetando acentos y guiones', () => {
    expect(titleCase('DE BRUM')).toBe('De Brum');
    expect(titleCase('GIMÉNEZ')).toBe('Giménez');
    expect(titleCase('saint-just')).toBe('Saint-Just');
  });
  it('número de camiseta', () => {
    expect(toShirt('12')).toBe(12);
    expect(toShirt(' 9 ')).toBe(9);
    expect(toShirt('x')).toBeNull();
    expect(toShirt('120')).toBeNull();
  });
});

const raw: RawPlanilla = {
  header: { torneo: 'CLAUSURA', categoria: 'ABSOLUTA', campo: 'Estadio Campeones Olímpico', rival: 'ALIANZA', fecha: '14/11/2026', condicion: 'LOCAL' },
  guardameta_numero: 12,
  capitan_numero: 10,
  titulares: [
    { numero: 12, ficha: '2735285', nombre: 'AGUSTÍN', apellido: 'GIMÉNEZ', cedula: '5.578.015-0' }, // cédula debe ignorarse
    { numero: 10, ficha: '2687063', nombre: 'CRISTIAN', apellido: 'MARTÍNEZ' },
    { numero: 9, ficha: 'PROVISORIO', nombre: 'LAUTARO', apellido: 'AMARO' },
    { nombre: '', apellido: '' }, // fila vacía: se descarta
  ],
  suplentes: [{ numero: 1, ficha: '2817707', nombre: 'CARLOS', apellido: 'DE BRUM' }],
};

describe('normalizePlanilla', () => {
  const n = normalizePlanilla(raw);

  it('descarta la cédula y filas vacías', () => {
    expect(n.players).toHaveLength(4);
    expect(JSON.stringify(n)).not.toContain('5.578.015');
    expect(JSON.stringify(n)).not.toContain('cedula');
  });

  it('marca arquero y capitán por número', () => {
    const gk = n.players.find((p) => p.shirtNumber === 12)!;
    const cap = n.players.find((p) => p.shirtNumber === 10)!;
    expect(gk.isGoalkeeper).toBe(true);
    expect(gk.isCaptain).toBe(false);
    expect(cap.isCaptain).toBe(true);
  });

  it('provisorio: ficha null y marca provisional', () => {
    const p = n.players.find((p) => p.fullName === 'Lautaro Amaro')!;
    expect(p.fichaOficial).toBeNull();
    expect(p.provisional).toBe(true);
  });

  it('titulares vs suplentes', () => {
    expect(n.players.filter((p) => p.isStarter)).toHaveLength(3);
    expect(n.players.filter((p) => !p.isStarter)).toHaveLength(1);
  });

  it('avisa que faltan titulares', () => {
    expect(n.warnings.some((w) => w.includes('titulares'))).toBe(true);
  });

  it('normaliza el encabezado', () => {
    expect(n.header.rival).toBe('Alianza');
    expect(n.header.condicion).toBe('local');
  });
});

describe('resolvePlayers', () => {
  const existing: ExistingPlayer = { id: 7, fullName: 'Agustín Giménez' };
  const lookup = {
    byFicha: new Map([['2735285', existing]]),
    byName: new Map([[nameKey('Lautaro Amaro'), { id: 9, fullName: 'Lautaro Amaro' }]]),
  };
  const n = normalizePlanilla(raw);
  const res = resolvePlayers(n.players, lookup);

  it('enlaza por ficha cuando existe', () => {
    expect(res.find((p) => p.shirtNumber === 12)).toMatchObject({ action: 'link', playerId: 7 });
  });
  it('crea cuando la ficha no existe', () => {
    expect(res.find((p) => p.shirtNumber === 10)).toMatchObject({ action: 'create', playerId: null });
  });
  it('provisorio: enlaza por nombre si coincide', () => {
    expect(res.find((p) => p.fullName === 'Lautaro Amaro')).toMatchObject({ action: 'link', playerId: 9 });
  });
});
