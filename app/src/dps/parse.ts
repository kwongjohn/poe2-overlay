// Parse a build's modifier text (passive node stats + item mods) into an
// aggregate damage profile for the DPS comparator. This is heuristic: PoE mod
// text is freeform and our .build data has no structured damage values, so we
// pattern-match the common lines. Conversions, conditional/enemy mods, and
// support-gem "more" multipliers (whose values aren't in our data) are skipped.
import { cleanStatText } from '../render/statText';

export type DmgType =
  | 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos' | 'elemental'
  | 'spell' | 'attack' | 'projectile' | 'area' | 'melee' | 'dot' | 'all';

export interface DamageProfile {
  increased: Record<string, number>;      // summed increased % per type
  more: Record<string, number[]>;          // each "more" %  (multiplicative)
  added: Record<string, [number, number]>; // flat added [min,max] per element
  attackSpeed: number;
  castSpeed: number;
  critChance: number;                       // increased crit chance %
  critMulti: number;                        // + crit damage/multiplier %
}

export function emptyProfile(): DamageProfile {
  return {
    increased: {}, more: {},
    added: { physical: [0, 0], fire: [0, 0], cold: [0, 0], lightning: [0, 0], chaos: [0, 0] },
    attackSpeed: 0, castSpeed: 0, critChance: 0, critMulti: 0,
  };
}

const TYPE_WORD: Record<string, DmgType> = {
  physical: 'physical', fire: 'fire', cold: 'cold', lightning: 'lightning', chaos: 'chaos',
  elemental: 'elemental', spell: 'spell', attack: 'attack', projectile: 'projectile',
  area: 'area', melee: 'melee', global: 'all',
};

// "Spell" -> [spell]; "Fire and Lightning" -> [fire,lightning]; "" -> [all].
function typesFromPhrase(phrase: string): DmgType[] {
  const words = phrase.toLowerCase().replace(/\band\b|,/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<DmgType>();
  for (const w of words) if (TYPE_WORD[w]) out.add(TYPE_WORD[w]);
  return out.size ? [...out] : ['all'];
}

function addInc(p: DamageProfile, t: DmgType, v: number) { p.increased[t] = (p.increased[t] || 0) + v; }

// Clean one raw stat line: strip PoE markup + a leading "3. " list number.
function cleanLine(raw: string): string {
  return cleanStatText(raw).replace(/^\s*\d+\.\s*/, '').trim();
}

export function parseMods(rawLines: string[]): DamageProfile {
  const p = emptyProfile();
  for (const raw of rawLines) {
    const s = cleanLine(raw);
    if (!s) continue;
    let m: RegExpExecArray | null;

    // Damage over time (before generic increased-damage).
    if ((m = /(\d+)%\s+increased\s+.*?Damage over Time/i.exec(s))) { addInc(p, 'dot', +m[1]); continue; }

    // Flat added damage.
    if ((m = /Adds?\s+(\d+)\s+to\s+(\d+)\s+(\w+)\s+Damage/i.exec(s))) {
      const t = TYPE_WORD[m[3].toLowerCase()];
      if (t && p.added[t]) { p.added[t][0] += +m[1]; p.added[t][1] += +m[2]; }
      continue;
    }

    // More multipliers.
    if ((m = /(\d+)%\s+more\s+(.*?)\s*Damage\b/i.exec(s))) {
      for (const t of typesFromPhrase(m[2])) (p.more[t] ||= []).push(+m[1]);
      continue;
    }

    // Crit (before generic increased-damage, since "Critical … Damage" contains "Damage").
    if ((m = /(\d+)%\s+increased\s+Critical\s+(?:Hit|Strike)\s+Chance/i.exec(s))) { p.critChance += +m[1]; continue; }
    if ((m = /(\d+)%\s+(?:increased\s+)?(?:to\s+)?Critical\s+(?:Hit|Strike)\s+(?:Damage|Multiplier)/i.exec(s))) { p.critMulti += +m[1]; continue; }

    // Speeds.
    if ((m = /(\d+)%\s+increased\s+Attack\s+Speed/i.exec(s))) { p.attackSpeed += +m[1]; continue; }
    if ((m = /(\d+)%\s+increased\s+Cast\s+Speed/i.exec(s))) { p.castSpeed += +m[1]; continue; }

    // Generic increased damage (typed or untyped) — last, so specifics win.
    if ((m = /(\d+)%\s+increased\s+(.*?)\s*Damage\b/i.exec(s))) {
      for (const t of typesFromPhrase(m[2])) addInc(p, t, +m[1]);
      continue;
    }
  }
  return p;
}

// Collect a build's stat lines: passive node stats (via a lookup) + item mod text.
export function gatherStatLines(
  build: { passives?: { id: string }[]; inventory_slots?: { additional_text?: string }[] },
  nodeStats: (id: string) => string[] | undefined,
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const p of build.passives ?? []) {
    if (seen.has(p.id)) continue; // dedupe weapon-set / duplicate entries
    seen.add(p.id);
    for (const st of nodeStats(p.id) ?? []) lines.push(st);
  }
  for (const it of build.inventory_slots ?? []) {
    if (it.additional_text) for (const l of it.additional_text.split('\n')) lines.push(l);
  }
  return lines;
}
