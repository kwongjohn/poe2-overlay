import { describe, it, expect } from 'vitest';
import { computeDps } from './calc';
import { emptyProfile } from './parse';

const base = { baseHit: 100, baseCritChance: 0, baseCritMulti: 150, baseSpeed: 1, projectiles: 1, baseDot: 0 };

describe('computeDps', () => {
  it('applies spell increases + cast speed (no crit)', () => {
    const p = emptyProfile();
    p.increased.spell = 100; p.increased.chaos = 50; p.castSpeed = 40;
    const r = computeDps(p, { ...base, archetype: 'spell' });
    // incHit = spell(100) + chaos(50) = 150 → avgHit 100*2.5 = 250; speed 1.4; crit 1
    expect(r.avgHit).toBeCloseTo(250, 5);
    expect(r.hit).toBeCloseTo(350, 5);
    expect(r.index).toBeCloseTo(3.5, 5);
  });

  it('applies crit correctly', () => {
    const p = emptyProfile();
    p.increased.spell = 100; p.increased.chaos = 50; p.castSpeed = 40;
    const r = computeDps(p, { ...base, archetype: 'spell', baseCritChance: 20 });
    // effCrit = 1 + 0.2*(1.5-1) = 1.1 → hit 250*1.1*1.4 = 385
    expect(r.effCrit).toBeCloseTo(1.1, 5);
    expect(r.hit).toBeCloseTo(385, 5);
  });

  it('uses attack speed + projectiles for attacks, not cast speed', () => {
    const p = emptyProfile();
    p.increased.attack = 30; p.increased.physical = 20; p.attackSpeed = 25; p.castSpeed = 999;
    const r = computeDps(p, { archetype: 'attack', baseHit: 200, baseCritChance: 5, baseCritMulti: 150, baseSpeed: 1.2, projectiles: 3, baseDot: 0 });
    // incHit = physical(20)+attack(30)=50 → avgHit 300; effCrit 1+0.05*0.5=1.025; speed 1.5; ×3 proj
    expect(r.avgHit).toBeCloseTo(300, 5);
    expect(r.speedMult).toBeCloseTo(1.25, 5);
    expect(r.hit).toBeCloseTo(300 * 1.025 * 1.5 * 3, 4);
  });

  it('scales DoT by dot + chaos increases, independent of crit/speed', () => {
    const p = emptyProfile();
    p.increased.dot = 100; p.increased.chaos = 50; p.castSpeed = 40; p.critChance = 500;
    const r = computeDps(p, { ...base, archetype: 'spell', baseDot: 100 });
    // incDot = dot(100)+chaos(50)=150 → 100*2.5 = 250, unaffected by crit/speed
    expect(r.dot).toBeCloseTo(250, 5);
  });

  it('applies more multipliers multiplicatively', () => {
    const p = emptyProfile();
    p.more.spell = [30, 20];
    const r = computeDps(p, { ...base, archetype: 'spell' });
    // avgHit = 100 * 1.0 * 1.3 * 1.2 = 156
    expect(r.avgHit).toBeCloseTo(156, 5);
  });
});
