import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../state';
import RangeBar from './RangeBar';
import MarkupField from './MarkupField';
import ModeToggle from './ModeToggle';
import type { Mode } from './ModeToggle';
import ItemsCompare from './ItemsCompare';

// inventory_id values follow the official format (suffixed, e.g. Helm1 / Ring1 / Ring2),
// matching the GGG docs sample (Weapon1, BodyArmour1, Helm1, Gloves1, Boots1, Belt1, Ring1, Ring2, Amulet1).
const GROUPS: [string, string[]][] = [
  ['Weapons', ['Weapon1', 'Offhand1', 'Weapon2', 'Offhand2']],
  ['Armour', ['Helm1', 'BodyArmour1', 'Gloves1', 'Boots1']],
  ['Jewellery', ['Amulet1', 'Belt1', 'Ring1', 'Ring2']],
  ['Flasks & Charms', ['Flask1', 'Flask2', 'Charm1', 'Charm2', 'Charm3']],
];

// Display-only: 'BodyArmour' -> 'Body Armour', 'Weapon1' -> 'Weapon 1'. Stored inventory_id is unchanged.
const prettySlot = (slot: string) => slot.replace(/([a-z])([A-Z0-9])/g, '$1 $2');

const wrap: CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: 24 };
const titleRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, margin: '0 0 14px' };
const title: CSSProperties = {
  margin: 0, fontSize: 22, letterSpacing: '0.12em', textTransform: 'uppercase',
};
const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, marginTop: 8,
};
const colHead: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.14em', color: 'var(--gold)', margin: '0 0 8px', paddingBottom: 6,
  borderBottom: '1px solid var(--line)',
};

const card: CSSProperties = {
  padding: 9, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 5,
};
const slotName: CSSProperties = { flex: 1, color: 'var(--gold-bright)', letterSpacing: '0.02em' };

export default function ItemsPanel() {
  const itemRanges = useStore((s) => s.itemRanges);
  const activeItemId = useStore((s) => s.activeItemId);
  const setItem = useStore((s) => s.setItem);
  const clearItem = useStore((s) => s.clearItem);

  const [mode, setMode] = useState<Mode>('edit');
  const items = itemRanges.find((r) => r.id === activeItemId)?.items ?? [];

  if (mode === 'compare') {
    return (
      <div style={wrap}>
        <div style={titleRow}>
          <h2 style={title}>Equipment</h2>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <ItemsCompare />
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={titleRow}>
        <h2 style={title}>Equipment</h2>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      <RangeBar domain="items" />
      <div style={grid}>
        {GROUPS.map(([title, slots]) => (
          <div key={title}>
            <div style={colHead}>{title}</div>
            {slots.map((slot) => {
              const item = items.find((it) => it.inventory_id === slot);
              const onText = (v: string) => setItem(slot, { additionalText: v, uniqueName: item?.unique_name });
              const onUnique = (v: string) => setItem(slot, { additionalText: item?.additional_text, uniqueName: v });
              return (
                <div key={slot} className="card" style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={slotName}>{prettySlot(slot)}</strong>
                    {item && <button onClick={() => clearItem(slot)}>Clear</button>}
                  </div>
                  <input
                    placeholder="Unique name"
                    value={item?.unique_name ?? ''}
                    onChange={(e) => onUnique(e.target.value)}
                    style={{ width: '100%' }}
                  />
                  <MarkupField
                    value={item?.additional_text ?? ''}
                    onChange={onText}
                    placeholder="Item description / mods…"
                    title={`${prettySlot(slot)} — description`}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
