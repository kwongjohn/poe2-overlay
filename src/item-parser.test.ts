// Synthetic fixtures based on the PoE2 clipboard format. Real captured items
// accumulate under test/fixtures/items/ — extend these tests from those as they land.
import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseItem, looksLikeItem } from './item-parser';

const RARE_ARMOUR = `Item Class: Body Armours
Rarity: Rare
Corruption Cloak
Expert Keth Raiment
--------
Quality: +20% (augmented)
Energy Shield: 456 (augmented)
--------
Requirements:
Level: 65
Int: 157
--------
Sockets: S S
--------
Item Level: 81
--------
+50 to maximum Energy Shield (rune)
--------
33% increased Energy Shield
+104 to maximum Life
+35% to Chaos Resistance
--------
Corrupted`;

const CURRENCY = `Item Class: Stackable Currency
Rarity: Currency
Exalted Orb
--------
Stack Size: 23/20
--------
Augments a Rare item with a new random modifier`;

const WAYSTONE = `Item Class: Waystones
Rarity: Rare
Chaos Core
Waystone (Tier 15)
--------
Waystone Tier: 15
Waystone Drop Chance: +80% (augmented)
--------
Item Level: 82
--------
Area is inhabited by Undead
Monsters deal 25% extra Damage as Chaos
Players are Cursed with Enfeeble
--------
Can only be used once`;

test('rare armour with rune, quality, sockets, corrupted', () => {
  const it = parseItem(RARE_ARMOUR)!;
  assert.equal(it.itemClass, 'Body Armours');
  assert.equal(it.rarity, 'Rare');
  assert.equal(it.name, 'Corruption Cloak');
  assert.equal(it.baseType, 'Expert Keth Raiment');
  assert.equal(it.quality, 20);
  assert.equal(it.itemLevel, 81);
  assert.equal(it.sockets, 2);
  assert.equal(it.corrupted, true);
  assert.equal(it.properties['Energy Shield'], '456');
  assert.deepEqual(it.runes, ['+50 to maximum Energy Shield']);
  assert.equal(it.explicits.length, 3);
  assert.deepEqual(it.requirements, { Level: 65, Int: 157 });
});

test('stackable currency', () => {
  const it = parseItem(CURRENCY)!;
  assert.equal(it.itemClass, 'Stackable Currency');
  assert.equal(it.name, 'Exalted Orb');
  assert.deepEqual(it.stackSize, { cur: 23, max: 20 });
  assert.equal(it.explicits.length, 0); // description text is not a mod
});

test('waystone mods and tier', () => {
  const it = parseItem(WAYSTONE)!;
  assert.equal(it.itemClass, 'Waystones');
  assert.equal(it.properties['Waystone Tier'], '15');
  assert.equal(it.itemLevel, 82);
  assert.equal(it.explicits.length, 3);
});

test('non-items are rejected', () => {
  assert.equal(looksLikeItem('hello world'), false);
  assert.equal(parseItem('just some text\nwith lines'), null);
});

// Real capture (2026-07-10): unidentified magic item, single-line PoE2 "Requires:".
const UNID_MAGIC = `Item Class: Body Armours
Rarity: Magic
Vile Robe
--------
Energy Shield: 171
--------
Requires: 121 Intelligence
--------
Item Level: 79
--------
Unidentified`;

test('unidentified magic item (real capture)', () => {
  const it = parseItem(UNID_MAGIC)!;
  assert.equal(it.rarity, 'Magic');
  assert.equal(it.name, 'Vile Robe');
  assert.equal(it.unidentified, true);
  assert.equal(it.itemLevel, 79);
  assert.equal(it.explicits.length, 0);
  assert.equal(it.properties['Energy Shield'], '171');
  // PoE2 single-line requirement form
  assert.deepEqual(it.requirements, { Intelligence: 121 });
});

test('single-line multi-part requirements', () => {
  const it = parseItem('Item Class: Belts\nRarity: Normal\nMail Belt\n--------\nRequires: Level 40, 55 Str')!;
  assert.deepEqual(it.requirements, { Level: 40, Str: 55 });
});

// Every real item captured in-game lands in test/fixtures/items/ (via the
// server's ingest corpus). All of them must at least parse with a header —
// this test grows automatically as John plays.
test('captured corpus parses', () => {
  const dir = path.join(__dirname, '..', 'test', 'fixtures', 'items');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const it = parseItem(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(it, `${f}: did not parse`);
    assert.ok(it.itemClass, `${f}: no item class`);
    assert.ok(it.rarity, `${f}: no rarity`);
    assert.ok(it.name, `${f}: no name`);
  }
});
