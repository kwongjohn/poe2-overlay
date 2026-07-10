import { describe, it, expect } from 'vitest';
import { parseMods } from './parse';

describe('parseMods', () => {
  it('parses increased damage by type and strips list numbers', () => {
    const p = parseMods(['1. 119% increased Chaos Damage', '3. 238% increased Spell Damage']);
    expect(p.increased.chaos).toBe(119);
    expect(p.increased.spell).toBe(238);
  });

  it('parses attack and cast speed separately from movement speed', () => {
    const p = parseMods(['43% increased Cast Speed', '10% increased Attack Speed', '35% increased Movement Speed']);
    expect(p.castSpeed).toBe(43);
    expect(p.attackSpeed).toBe(10);
  });

  it('parses flat added damage to an element', () => {
    const p = parseMods(['Adds 20 to 31 Cold damage to Attacks']);
    expect(p.added.cold).toEqual([20, 31]);
  });

  it('parses crit and DoT, not as generic damage', () => {
    const p = parseMods([
      '35% increased Critical Hit Chance',
      '+25% to Critical Hit Damage',
      '19% increased Chaos Damage over Time',
    ]);
    expect(p.critChance).toBe(35);
    expect(p.critMulti).toBe(25);
    expect(p.increased.dot).toBe(19);
    expect(p.increased.all ?? 0).toBe(0); // the crit line must not count as generic damage
  });

  it('ignores prose, conversion, and un-numbered mentions', () => {
    const p = parseMods([
      'Gain 60% of Damage as Extra Cold Damage',
      'Your primary prefix goal is Increased Chaos Damage',
    ]);
    expect(Object.keys(p.increased).length).toBe(0);
  });

  it('sums duplicates and cleans PoE markup tokens', () => {
    const p = parseMods(['10% increased [Fire] Damage', '5% increased Fire Damage']);
    expect(p.increased.fire).toBe(15);
  });

  it('parses more multipliers as a multiplicative list', () => {
    const p = parseMods(['30% more Spell Damage', '20% more Spell Damage']);
    expect(p.more.spell).toEqual([30, 20]);
  });
});
