import { describe, expect, it } from 'vitest';
import { parseJsonObject } from './planilla-ai-core';

describe('parseJsonObject', () => {
  it('lee JSON pelado', () => {
    expect(parseJsonObject('{"guardameta_numero":12}')).toMatchObject({ guardameta_numero: 12 });
  });
  it('lee JSON dentro de ```json', () => {
    const t = 'Acá va:\n```json\n{"capitan_numero":10}\n```\ngracias';
    expect(parseJsonObject(t)).toMatchObject({ capitan_numero: 10 });
  });
  it('lee JSON con texto suelto alrededor', () => {
    expect(parseJsonObject('Resultado: {"titulares":[]} fin')).toMatchObject({ titulares: [] });
  });
  it('falla si no hay JSON', () => {
    expect(() => parseJsonObject('no hay nada')).toThrow();
  });
});
