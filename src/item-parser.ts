// Parser for PoE2's clipboard item text (Ctrl+C / Ctrl+Alt+C on a hovered item).
// Deliberately tolerant: the format drifts across patches, so unknown blocks are
// skipped, never fatal. Real captured items accumulate as fixtures under
// test/fixtures/items/ via the companion server — regression-test against those.

export interface ParsedItem {
  itemClass: string;
  rarity: string;
  name: string;          // display name (Rare/Unique first line; else base line)
  baseType: string;      // base item line ('' when same as name)
  quality: number | null;
  itemLevel: number | null;
  stackSize: { cur: number; max: number } | null;
  sockets: number | null;
  corrupted: boolean;
  unidentified: boolean;
  requirements: Record<string, number>;
  properties: Record<string, string>;   // e.g. "Energy Shield" → "456", "Waystone Tier" → "15"
  implicits: string[];
  explicits: string[];
  runes: string[];
  enchants: string[];
}

const SEP = /^-{4,}$/;
// A line that plausibly is a mod (numbers or standard mod verbs).
const MOD_LIKE = /\d|increased|reduced|Adds|Grants|Gain|Recover|Immun|Cannot|Allies|Minions|Trigger/i;

export function looksLikeItem(text: string): boolean {
  return /^(Item Class|Rarity):/m.test(text);
}

export function parseItem(text: string): ParsedItem | null {
  const blocks: string[][] = [[]];
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Advanced-copy group headers like "{ Prefix Modifier "Robust" (Tier: 3) }"
    if (line.startsWith('{') && line.endsWith('}')) continue;
    if (SEP.test(line)) blocks.push([]);
    else blocks[blocks.length - 1].push(line);
  }
  const head = blocks.shift() || [];
  if (!head.length) return null;

  const kv = (line: string) => {
    const i = line.indexOf(': ');
    return i > 0 ? ([line.slice(0, i), line.slice(i + 2)] as const) : null;
  };

  const item: ParsedItem = {
    itemClass: '', rarity: '', name: '', baseType: '',
    quality: null, itemLevel: null, stackSize: null, sockets: null,
    corrupted: false, unidentified: false,
    requirements: {}, properties: {},
    implicits: [], explicits: [], runes: [], enchants: [],
  };

  const nameLines: string[] = [];
  for (const line of head) {
    const p = kv(line);
    if (p && p[0] === 'Item Class') item.itemClass = p[1];
    else if (p && p[0] === 'Rarity') item.rarity = p[1];
    else nameLines.push(line);
  }
  if (!item.itemClass && !item.rarity) return null;
  item.name = nameLines[0] || '';
  item.baseType = nameLines[1] || '';

  for (const block of blocks) {
    // Single-line flags
    if (block.length === 1 && block[0] === 'Corrupted') { item.corrupted = true; continue; }
    if (block.length === 1 && block[0] === 'Unidentified') { item.unidentified = true; continue; }

    if (block[0] === 'Requirements:') {
      for (const line of block.slice(1)) {
        const p = kv(line);
        if (p) {
          const n = parseInt(p[1].replace(/[^\d]/g, ''), 10);
          if (Number.isFinite(n)) item.requirements[p[0]] = n;
        }
      }
      continue;
    }

    const candidates: string[] = [];
    for (const line of block) {
      const p = kv(line);
      if (p && !/^[+\-\d]/.test(line)) {
        // "Key: value" property line (mods never start with a bare keyword + ': ')
        const [k, v] = p;
        if (k === 'Quality') item.quality = parseInt(v.replace(/[^\d-]/g, ''), 10) || null;
        else if (k === 'Item Level') item.itemLevel = parseInt(v, 10) || null;
        else if (k === 'Stack Size') {
          const m = /^([\d,]+)\/([\d,]+)/.exec(v);
          if (m) item.stackSize = { cur: +m[1].replace(/,/g, ''), max: +m[2].replace(/,/g, '') };
        } else if (k === 'Sockets') item.sockets = (v.match(/S/g) || []).length;
        else if (k === 'Requires') {
          // PoE2 single-line form: "Requires: Level 40" / "121 Intelligence" /
          // "Level 64, 120 Str, 68 Int" (block form handled above).
          for (const part of v.split(',').map((s) => s.trim())) {
            let m = /^Level (\d+)/.exec(part);
            if (m) { item.requirements.Level = +m[1]; continue; }
            m = /^(\d+) (\w+)/.exec(part.replace(/ \(unmet\)$/, ''));
            if (m) item.requirements[m[2]] = +m[1];
          }
        }
        else item.properties[k] = v.replace(/ \((augmented|unmet)\)$/, '');
        continue;
      }
      // Mod lines, possibly tagged by advanced copy
      const tag = /^(.*?) \((implicit|rune|enchant|crafted|fractured|desecrated)\)$/.exec(line);
      if (tag) {
        if (tag[2] === 'implicit') item.implicits.push(tag[1]);
        else if (tag[2] === 'rune') item.runes.push(tag[1]);
        else if (tag[2] === 'enchant') item.enchants.push(tag[1]);
        else item.explicits.push(tag[1]);
      } else {
        candidates.push(line);
      }
    }
    // Block-level call: mods travel together in one block, so if any line looks
    // like a mod, the whole block is mods (catches numberless map mods like
    // "Area is inhabited by Undead"). Pure description/flavour blocks match
    // nothing and are dropped.
    if (candidates.length && candidates.some(l => MOD_LIKE.test(l))) {
      item.explicits.push(...candidates);
    }
  }
  return item;
}
