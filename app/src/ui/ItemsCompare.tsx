// Side-by-side Equipment comparison: your gear (from the editor's serialize, later
// the GGG API) vs the exported plan, per slot. Shows the item name and its mods
// (from additional_text) as detail. Real item level / quality / sockets fill in once
// the GGG character API is connected — the plan format only carries the mod text.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../state';

const API = 'http://127.0.0.1:4517/api';

interface RawItem { inventory_id: string; unique_name?: string; additional_text?: string }

// Slot render order (mirrors the editor's grouping).
const SLOT_ORDER = [
  'Weapon1', 'Offhand1', 'Weapon2', 'Offhand2',
  'Helm1', 'BodyArmour1', 'Gloves1', 'Boots1',
  'Amulet1', 'Belt1', 'Ring1', 'Ring2',
  'Flask1', 'Flask2', 'Charm1', 'Charm2', 'Charm3',
];
const prettySlot = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2');

const wrap: CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: 24 };
const headerRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 44px 1fr', gap: 8, marginBottom: 8 };
const colHead: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)',
};
const rowGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 44px 1fr', gap: 8, marginBottom: 10, alignItems: 'stretch' };
const statusCol: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 };
const cellBase: CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)' };
const slotLabel: CSSProperties = { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' };
const itemTitleS: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13.5, color: 'var(--text-bright)', margin: '2px 0' };
const modsS: CSSProperties = { color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-line' };
const emptyCell: CSSProperties = { ...cellBase, borderStyle: 'dashed', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 40, fontSize: 12 };

function cleanText(s: string): string {
  return s.replace(/<\/?b>/g, '').replace(/\{([^}]*)\}/g, '$1');
}
function itemTitle(it: RawItem): string {
  if (it.unique_name) return it.unique_name;
  const first = (it.additional_text ?? '').split('\n')[0].trim();
  return first && first.length <= 44 && !first.includes('{') ? first : prettySlot(it.inventory_id);
}
function modsOf(it: RawItem): string {
  // Drop the first line if we already used it as the title (base type).
  const lines = (it.additional_text ?? '').split('\n');
  const body = it.unique_name ? lines : lines.slice(1);
  return cleanText(body.join('\n')).trim();
}

export default function ItemsCompare() {
  const serialize = useStore((s) => s.serialize);
  const itemRanges = useStore((s) => s.itemRanges);
  const activeItemId = useStore((s) => s.activeItemId);
  const current: RawItem[] = useMemo(() => {
    try { return (JSON.parse(serialize()).inventory_slots as RawItem[]) ?? []; } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialize, itemRanges, activeItemId]);

  const [planned, setPlanned] = useState<RawItem[] | null>(null);
  const [planName, setPlanName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const j = await (await fetch(`${API}/target-build`)).json();
        if (off) return;
        if (!j.exported) { setState('none'); return; }
        setPlanned(j.build.inventory_slots ?? []);
        setPlanName(j.name ?? 'plan');
        setState('ready');
      } catch { if (!off) setState('none'); }
    })();
    return () => { off = true; };
  }, []);

  if (state === 'loading') return <div style={{ ...wrap, color: 'var(--text-muted)' }}>Loading plan…</div>;
  if (state === 'none') return <div style={{ ...wrap, color: 'var(--text-muted)' }}>No compare target set. Open <b>Library</b> and click <b>Target</b> on the build you want to compare against.</div>;

  const bySlot = (items: RawItem[], slot: string) => items.filter((it) => it.inventory_id === slot);
  const slots = [...new Set([...SLOT_ORDER, ...current.map((i) => i.inventory_id), ...(planned ?? []).map((i) => i.inventory_id)])];

  const Cell = ({ items, slot }: { items: RawItem[]; slot: string }) => {
    if (items.length === 0) return <div style={emptyCell}><span style={slotLabel}>{prettySlot(slot)}</span><span>— empty —</span></div>;
    return (
      <div className="card" style={cellBase}>
        <div style={slotLabel}>{prettySlot(slot)}</div>
        {items.map((it, k) => {
          const mods = modsOf(it);
          return (
            <div key={k} style={{ marginTop: k ? 6 : 0 }}>
              <div style={itemTitleS}>{itemTitle(it)}</div>
              {mods && <div style={modsS}>{mods}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const labelSet = (items: RawItem[]) => new Set(items.map((it) => itemTitle(it)));
  const eqSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

  const rows = slots
    .map((slot) => ({ slot, cur: bySlot(current, slot), plan: bySlot(planned ?? [], slot) }))
    .filter((r) => r.cur.length > 0 || r.plan.length > 0);

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div style={colHead}>Your gear</div>
        <div />
        <div style={colHead}>Plan · {planName}</div>
      </div>
      {rows.map(({ slot, cur, plan }) => {
        const curL = labelSet(cur), planL = labelSet(plan);
        let status: 'match' | 'swap' | 'missing' | 'off';
        if (cur.length && plan.length) status = eqSet(curL, planL) ? 'match' : 'swap';
        else if (plan.length) status = 'missing';
        else status = 'off';
        const mark = status === 'match' ? '✓' : status === 'missing' ? '→' : status === 'swap' ? '≠' : '✕';
        const color = status === 'match' ? 'var(--jade)' : status === 'swap' ? 'var(--gold)' : status === 'missing' ? 'var(--gold)' : 'var(--text-dim)';
        return (
          <div key={slot} style={rowGrid}>
            <Cell items={cur} slot={slot} />
            <div style={{ ...statusCol, color }} title={status === 'match' ? 'Matches the plan' : status === 'swap' ? 'Different item than planned' : status === 'missing' ? 'Planned — not equipped yet' : 'Equipped but not in the plan'}>{mark}</div>
            <Cell items={plan} slot={slot} />
          </div>
        );
      })}
      <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>
        Item level, quality and sockets appear here once your account is connected — the plan file only carries mod text.
      </div>
    </div>
  );
}
