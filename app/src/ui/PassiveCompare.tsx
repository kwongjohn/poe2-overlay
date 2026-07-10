// Side-by-side passive-tree comparison: your build (from the editor's serialize,
// later the GGG API) vs the exported plan. Node ids are resolved through the loaded
// tree data into names + stats and grouped by kind. Keystones / notables / ascendancy
// are shown as aligned rows with their stats as detail; the many small passives are
// summarized as counts.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../state';
import type { TreeNode } from '../tree/types';
import { cleanStatText } from '../render/statText';

const API = 'http://127.0.0.1:4517/api';

interface RawPassive { id: string }
type Kind = 'ascendancy' | 'keystone' | 'notable' | 'jewel' | 'mastery' | 'small' | 'other';
interface Entry { id: string; node?: TreeNode; inCur: boolean; inPlan: boolean; kind: Kind }

const wrap: CSSProperties = {
  position: 'absolute', inset: 0, overflowY: 'auto', padding: '52px 24px 40px',
  background: 'var(--bg)', zIndex: 5,
};
const inner: CSSProperties = { maxWidth: 1100, margin: '0 auto' };
const summary: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '6px 22px', margin: '2px 0 14px',
  fontSize: 13.5, color: 'var(--text)',
};
const sectionTitle: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'var(--text-muted)', margin: '16px 0 6px',
};
const rowGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 8, marginBottom: 8 };
const statusCol: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 };
const cellBase: CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)' };
const nodeName: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13.5, color: 'var(--text-bright)' };
const statLine: CSSProperties = { color: 'var(--text-muted)', fontSize: 12, marginTop: 3, lineHeight: 1.4 };
const emptyCell: CSSProperties = { ...cellBase, borderStyle: 'dashed', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', minHeight: 34, fontSize: 12 };

function kindOf(node?: TreeNode): Kind {
  if (!node) return 'other';
  if (node.ascendancyId) return 'ascendancy';
  if (node.isKeystone) return 'keystone';
  if (node.isNotable) return 'notable';
  if (node.isJewelSocket) return 'jewel';
  if (node.isMastery) return 'mastery';
  return 'small';
}

export default function PassiveCompare() {
  const tree = useStore((s) => s.tree);
  const serialize = useStore((s) => s.serialize);
  const passiveRanges = useStore((s) => s.passiveRanges);
  const activePassiveId = useStore((s) => s.activePassiveId);

  const current: RawPassive[] = useMemo(() => {
    try { return (JSON.parse(serialize()).passives as RawPassive[]) ?? []; } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialize, passiveRanges, activePassiveId]);

  const [planned, setPlanned] = useState<RawPassive[] | null>(null);
  const [planName, setPlanName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const j = await (await fetch(`${API}/target-build`)).json();
        if (off) return;
        if (!j.exported) { setState('none'); return; }
        setPlanned(j.build.passives ?? []);
        setPlanName(j.name ?? 'plan');
        setState('ready');
      } catch { if (!off) setState('none'); }
    })();
    return () => { off = true; };
  }, []);

  const entries = useMemo<Entry[]>(() => {
    if (!tree || !planned) return [];
    const curIds = new Set(current.map((p) => p.id));
    const planIds = new Set(planned.map((p) => p.id));
    const all = new Set<string>([...curIds, ...planIds]);
    const out: Entry[] = [];
    for (const id of all) {
      const node = tree.nodesById.get(id);
      out.push({ id, node, inCur: curIds.has(id), inPlan: planIds.has(id), kind: kindOf(node) });
    }
    return out;
  }, [tree, planned, current]);

  if (state === 'loading') return <div style={wrap}><div style={inner}>Loading plan…</div></div>;
  if (state === 'none') return <div style={wrap}><div style={{ ...inner, color: 'var(--text-muted)' }}>No compare target set. Open <b>Library</b> and click <b>Target</b> on the build you want to compare against.</div></div>;

  const byKind = (k: Kind) => entries.filter((e) => e.kind === k);
  const counts = (k: Kind) => {
    const list = byKind(k);
    return { matched: list.filter((e) => e.inCur && e.inPlan).length, planned: list.filter((e) => e.inPlan).length, off: list.filter((e) => e.inCur && !e.inPlan).length };
  };
  const totalMatched = entries.filter((e) => e.inCur && e.inPlan).length;
  const totalPlanned = entries.filter((e) => e.inPlan).length;
  const totalOff = entries.filter((e) => e.inCur && !e.inPlan).length;

  const Cell = ({ e, side }: { e?: Entry; side: 'cur' | 'plan' }) => {
    if (!e || (side === 'cur' && !e.inCur) || (side === 'plan' && !e.inPlan)) return <div style={emptyCell}>—</div>;
    const stats = e.node?.stats ?? [];
    return (
      <div className="card" style={cellBase}>
        <div style={nodeName}>{e.node?.name ?? e.id}</div>
        {stats.length > 0 && <div style={statLine}>{stats.slice(0, 3).map(cleanStatText).join(' · ')}</div>}
      </div>
    );
  };

  const Section = ({ kind, label }: { kind: Kind; label: string }) => {
    const list = byKind(kind).sort((a, b) => Number(b.inPlan) - Number(a.inPlan) || (a.node?.name ?? '').localeCompare(b.node?.name ?? ''));
    if (list.length === 0) return null;
    const c = counts(kind);
    return (
      <>
        <div style={sectionTitle}>{label} · <span style={{ color: 'var(--gold-bright)' }}>{c.matched}</span>/{c.planned}{c.off > 0 ? ` · ${c.off} off-plan` : ''}</div>
        {list.map((e) => {
          const status = e.inCur && e.inPlan ? 'match' : e.inPlan ? 'missing' : 'off';
          const mark = status === 'match' ? '✓' : status === 'missing' ? '→' : '✕';
          const color = status === 'match' ? 'var(--jade)' : status === 'missing' ? 'var(--gold)' : 'var(--text-dim)';
          return (
            <div key={e.id} style={rowGrid}>
              <Cell e={e} side="cur" />
              <div style={{ ...statusCol, color }}>{mark}</div>
              <Cell e={e} side="plan" />
            </div>
          );
        })}
      </>
    );
  };

  const small = counts('small');
  const jewel = counts('jewel');
  const mastery = counts('mastery');

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={summary}>
          <span><span style={{ color: 'var(--text-muted)' }}>Nodes </span><span style={{ color: 'var(--gold-bright)', fontWeight: 700 }}>{totalMatched}</span>/{totalPlanned}{totalOff > 0 ? <span style={{ color: 'var(--text-muted)' }}> · {totalOff} off-plan</span> : null}</span>
          <span style={{ color: 'var(--text-muted)' }}>vs {planName}</span>
        </div>

        <Section kind="ascendancy" label="Ascendancy" />
        <Section kind="keystone" label="Keystones" />
        <Section kind="notable" label="Notables" />

        <div style={sectionTitle}>Minor passives</div>
        <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}>
          Small passives: <b style={{ color: 'var(--gold-bright)' }}>{small.matched}</b>/{small.planned}{small.off > 0 ? ` (${small.off} off-plan)` : ''}<br />
          Jewel sockets: <b style={{ color: 'var(--gold-bright)' }}>{jewel.matched}</b>/{jewel.planned}
          {mastery.planned > 0 ? <> · Masteries: <b style={{ color: 'var(--gold-bright)' }}>{mastery.matched}</b>/{mastery.planned}</> : null}
        </div>
      </div>
    </div>
  );
}
