// Synthetic fixtures based on the PoE2 clipboard format. Real captured items
// accumulate under test/fixtures/items/ — extend these tests from those as they land.
import { test } from 'node:test';
import * as assert from 'node:assert';
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
