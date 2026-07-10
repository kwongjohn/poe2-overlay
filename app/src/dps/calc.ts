// DPS model over a parsed DamageProfile, in the style of poe2.dev's hit formula
// but archetype-aware (attack vs spell hit, plus damage-over-time). Absolute
// numbers depend on a base you supply; the base-independent "index" (multiplier
// stack) is what makes the target-vs-current comparison meaningful.
import type { DamageProfile } from './parse';

export type Archetype = 'attack' | 'spell';

export interface CalcInputs {
  archetype: Archetype;
  baseHit: number;      // avg base hit damage (weapon avg for attacks, skill base for spells)
  baseCritChance: number; // %, e.g. 5
  baseCritMulti: number;  // %, e.g. 150 (crit does +50%)
  baseSpeed: number;    // attacks or casts per second
  projectiles: number;  // hits that land per use
  baseDot: number;      // base damage-over-time per second (0 if none)
}

export interface DpsResult {
  hit: number;          // hit DPS
  dot: number;          // damage-over-time DPS
  total: number;
  avgHit: number;
  effCrit: number;      // effective crit multiplier on the average hit
  incHit: number;       // total increased % applied to the hit
  incDot: number;       // total increased % applied to DoT
  speedMult: number;    // 1 + speed increase
  index: number;        // base-independent damage multiplier (for comparison)
}

// Damage-type increases that apply to any hit; archetype adds its own.
const HIT_COMMON = ['physical', 'fire', 'cold', 'lightning', 'chaos', 'elemental', 'area', 'projectile', 'all'];
const DOT_KEYS = ['dot', 'chaos', 'fire', 'physical', 'all'];

const sumInc = (p: DamageProfile, keys: string[]) => keys.reduce((a, k) => a + (p.increased[k] || 0), 0);
const moreMult = (p: DamageProfile, keys: string[]) => {
  let m = 1;
  for (const k of keys) for (const v of p.more[k] || []) m *= 1 + v / 100;
  return m;
};
const addedAvg = (p: DamageProfile) =>
  (['physical', 'fire', 'cold', 'lightning', 'chaos'] as const)
    .reduce((a, k) => a + (p.added[k][0] + p.added[k][1]) / 2, 0);

export function computeDps(p: DamageProfile, inp: CalcInputs): DpsResult {
  const hitKeys = [...HIT_COMMON, inp.archetype === 'attack' ? 'attack' : 'spell'];
  if (inp.archetype === 'attack') hitKeys.push('melee');

  const incHit = sumInc(p, hitKeys);
  const hitMore = moreMult(p, hitKeys);
  const base = inp.baseHit + addedAvg(p);
  const avgHit = base * (1 + incHit / 100) * hitMore;

  const cc = Math.min(1, (inp.baseCritChance * (1 + p.critChance / 100)) / 100);
  const cm = (inp.baseCritMulti + p.critMulti) / 100;
  const effCrit = 1 + cc * (cm - 1);

  const speedInc = inp.archetype === 'attack' ? p.attackSpeed : p.castSpeed;
  const speedMult = 1 + speedInc / 100;
  const speed = inp.baseSpeed * speedMult;

  const hit = avgHit * effCrit * speed * Math.max(1, inp.projectiles || 1);

  const incDot = sumInc(p, DOT_KEYS);
  const dot = inp.baseDot * (1 + incDot / 100) * moreMult(p, DOT_KEYS);

  // Base-independent index: what the modifier stack multiplies a unit hit by.
  const index = (1 + incHit / 100) * hitMore * effCrit * speedMult;

  return { hit, dot, total: hit + dot, avgHit, effCrit, incHit, incDot, speedMult, index };
}
