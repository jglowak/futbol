import { describe, expect, it } from 'vitest';
import { dbTypeFromUi, eventDetail, eventIcon, eventLabel, isGoalType } from './events-core';

describe('events-core', () => {
  it('mapea las opciones del panel a tipo de base', () => {
    expect(dbTypeFromUi('gol')).toBe('goal');
    expect(dbTypeFromUi('penal')).toBe('penalty_goal');
    expect(dbTypeFromUi('cambio')).toBe('sub');
    expect(dbTypeFromUi('inexistente')).toBeNull();
  });

  it('reconoce los goles para estadística', () => {
    expect(isGoalType('goal')).toBe(true);
    expect(isGoalType('own_goal')).toBe(true);
    expect(isGoalType('yellow_card')).toBe(false);
  });

  it('ícono por tipo', () => {
    expect(eventIcon('yellow_card')).toBe('🟨');
    expect(eventIcon('red_card')).toBe('🟥');
    expect(eventIcon('sub')).toBe('🔁');
    expect(eventIcon('goal')).toBe('⚽');
  });

  it('texto del evento', () => {
    expect(eventDetail({ type: 'goal', playerName: 'Silveira', relatedName: null })).toBe('Silveira');
    expect(eventDetail({ type: 'sub', playerName: 'García', relatedName: 'Pérez' })).toBe('Entra García, sale Pérez');
    expect(eventDetail({ type: 'sub', playerName: 'García', relatedName: null })).toBe('Entra García');
    expect(eventLabel('penalty_goal')).toBe('Gol de penal');
  });
});
