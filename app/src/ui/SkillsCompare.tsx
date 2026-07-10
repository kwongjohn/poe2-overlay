// Side-by-side Skills comparison: the build open in the editor (your "current",
// later fed by the GGG API) vs the exported plan. Matched by gem id, names/icons
// from the app's own gem data so both sides read consistently. Rows align on the
// same gem; a status column marks match / missing / off-plan, and support gems are
// highlighted where the two sides differ.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../state';
import { gemById } from '../gems';
import { GemIcon } from '../icons';

const API = 'http://127.0.0.1:4517/api';

interface RawSkill { id: string; support_skills?: { id: string }[] }

const wrap: CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: 24 };
const headerRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 44px 1fr', gap: 8, alignItems: 'center',
  marginBottom: 8, position: 'sticky', top: 0,
};
const colHead: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'var(--text-muted)', padding: '2px 4px',
};
const rowGrid: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 44px 1fr', gap: 8, alignItems: 'stretch', marginBottom: 10,
};
const statusCol: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700,
};
const cellBase: CSSProperties = { padding: 10, borderRadius: 6, border: '1px solid var(--line)' };
const gemRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const gemName: CSSProperties = {
  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--text-bright)',
};
const supList: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 6, paddingLeft: 2, fontSize: 12.5 };
const empty: CSSProperties = { ...cellBase, borderStyle: 'dashed', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, fontSize: 12 };

export default function SkillsCompare() {
  const gems = useStore((s) => s.gems);
  const serialize = useStore((s) => s.serialize);
  // Subscribe to the edited slices so we re-derive on change; take skills from
  // serialize() so ids are in .build format (matching the planned build's file).
  const skillRanges = useStore((s) => s.skillRanges);
  const activeSkillId = useStore((s) => s.activeSkillId);
  const current: RawSkill[] = useMemo(() => {
    try { return (JSON.parse(serialize()).skills as RawSkill[]) ?? []; } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialize, skillRanges, activeSkillId]);

  const [planned, setPlanned] = useState<RawSkill[] | null>(null);
  const [planName, setPlanName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const j = await (await fetch(`${API}/target-build`)).json();
        if (off) return;
        if (!j.exported) { setState('none'); return; }
        setPlanned(j.build.skills ?? []);
        setPlanName(j.name ?? 'plan');
        setState('ready');
      } catch { if (!off) setState('none'); }
    })();
    return () => { off = true; };
  }, []);

  const nameOf = (id: string) => (gems ? gemById(gems, id)?.displayName ?? id : id);
  const iconOf = (id: string) => (gems ? gemById(gems, id)?.iconDdsFile : undefined);
  const supIds = (s?: RawSkill) => (s?.support_skills ?? []).map((x) => x.id);

  if (state === 'loading') return <div style={{ ...wrap, color: 'var(--text-muted)' }}>Loading plan…</div>;
  if (state === 'none') return <div style={{ ...wrap, color: 'var(--text-muted)' }}>No compare target set. Open <b>Library</b> and click <b>Target</b> on the build you want to compare against.</div>;

  const curMap = new Map(current.map((s) => [s.id, s]));
  const planMap = new Map((planned ?? []).map((s) => [s.id, s]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of planned ?? []) if (!seen.has(s.id)) { order.push(s.id); seen.add(s.id); }
  for (const s of current) if (!seen.has(s.id)) { order.push(s.id); seen.add(s.id); }

  const Cell = ({ skill, otherSups, accent }: { skill?: RawSkill; otherSups: string[]; accent: string }) => {
    if (!skill) return <div style={empty}>—</div>;
    const icon = iconOf(skill.id);
    return (
      <div className="card" style={cellBase}>
        <div style={gemRow}>
          {icon && <GemIcon iconDdsFile={icon} size={26} />}
          <span style={gemName}>{nameOf(skill.id)}</span>
        </div>
        {supIds(skill).length > 0 && (
          <div style={supList}>
            {supIds(skill).map((sid) => {
              const differs = !otherSups.includes(sid);
              return (
                <span key={sid} style={{ color: differs ? accent : 'var(--text-muted)', fontWeight: differs ? 600 : 400 }}>
                  {differs ? '• ' : ''}{nameOf(sid)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div style={colHead}>Your build</div>
        <div />
        <div style={colHead}>Plan · {planName}</div>
      </div>
      {order.map((id) => {
        const cur = curMap.get(id);
        const plan = planMap.get(id);
        const status = cur && plan ? 'match' : plan ? 'missing' : 'off';
        const mark = status === 'match' ? '✓' : status === 'missing' ? '→' : '✕';
        const markColor = status === 'match' ? 'var(--jade)' : status === 'missing' ? 'var(--gold)' : 'var(--text-dim)';
        return (
          <div key={id} style={rowGrid}>
            <Cell skill={cur} otherSups={supIds(plan)} accent="var(--text-muted)" />
            <div style={{ ...statusCol, color: markColor }} title={status === 'match' ? 'In your build and the plan' : status === 'missing' ? 'In the plan — not in your build yet' : 'In your build but not the plan'}>{mark}</div>
            <Cell skill={plan} otherSups={supIds(cur)} accent="var(--gold)" />
          </div>
        );
      })}
      <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>
        <span style={{ color: 'var(--gold)' }}>•</span> highlighted support = differs between your build and the plan.
      </div>
    </div>
  );
}
