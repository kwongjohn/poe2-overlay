// DPS comparator: your current (loaded) build vs the compare target. Parses each
// build's mods into a damage profile and runs the same formula on both with a
// shared base, so the comparison is fair. Absolute DPS is an estimate (skill base
// damage isn't in our data); the base-independent "index" is the reliable metric.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../state';
import { parseMods, gatherStatLines } from '../dps/parse';
import type { DamageProfile } from '../dps/parse';
import { computeDps } from '../dps/calc';
import type { CalcInputs, Archetype, DpsResult } from '../dps/calc';

const API = 'http://127.0.0.1:4517/api';

const wrap: CSSProperties = { maxWidth: 1000, margin: '0 auto', padding: 24 };
const title: CSSProperties = { margin: '0 0 12px', fontSize: 22, letterSpacing: '0.12em', textTransform: 'uppercase' };
const barCard: CSSProperties = { padding: 12, marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'flex-end' };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };
const label: CSSProperties = { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' };
const num: CSSProperties = { width: 78 };
const cols: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
const col: CSSProperties = { padding: 14 };
const colHead: CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-bright)', marginBottom: 8 };
const big: CSSProperties = { fontSize: 30, fontWeight: 700, color: 'var(--text-bright)', lineHeight: 1.1 };
const statRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--line)', fontSize: 13 };
const mutedS: CSSProperties = { color: 'var(--text-muted)' };

const DEFAULTS: CalcInputs = {
  archetype: 'spell', baseHit: 100, baseCritChance: 5, baseCritMulti: 150, baseSpeed: 1, projectiles: 1, baseDot: 100,
};

function Num({ label: lbl, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label style={field}>
      <span style={label}>{lbl}</span>
      <input style={num} type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(1));

export default function DpsScreen() {
  const tree = useStore((s) => s.tree);
  const serialize = useStore((s) => s.serialize);
  const passiveRanges = useStore((s) => s.passiveRanges);
  const activePassiveId = useStore((s) => s.activePassiveId);
  const itemRanges = useStore((s) => s.itemRanges);

  const [inp, setInp] = useState<CalcInputs>(DEFAULTS);
  const [target, setTarget] = useState<{ name: string; build: unknown } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
  const set = (k: keyof CalcInputs, v: number | Archetype) => setInp((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const j = await (await fetch(`${API}/target-build`)).json();
        if (off) return;
        if (!j.exported) { setState('none'); return; }
        setTarget({ name: j.name ?? 'plan', build: j.build });
        setState('ready');
      } catch { if (!off) setState('none'); }
    })();
    return () => { off = true; };
  }, []);

  const nodeStats = (id: string) => tree?.nodesById.get(id)?.stats;
  const curBuild = useMemo(() => {
    try { return JSON.parse(serialize()); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialize, passiveRanges, activePassiveId, itemRanges]);

  const curProfile = useMemo<DamageProfile | null>(() => (curBuild && tree ? parseMods(gatherStatLines(curBuild, nodeStats)) : null), [curBuild, tree]);
  const tgtProfile = useMemo<DamageProfile | null>(() => (target && tree ? parseMods(gatherStatLines(target.build as never, nodeStats)) : null), [target, tree]);
  const curRes = curProfile ? computeDps(curProfile, inp) : null;
  const tgtRes = tgtProfile ? computeDps(tgtProfile, inp) : null;

  if (state === 'loading') return <div style={{ ...wrap, color: 'var(--text-muted)' }}>Loading target…</div>;
  if (state === 'none') return <div style={{ ...wrap, color: 'var(--text-muted)' }}>No compare target set. Library → <b>Target</b> on the build you want to measure against.</div>;

  const ratio = curRes && tgtRes && tgtRes.total > 0 ? curRes.total / tgtRes.total : null;

  return (
    <div style={wrap}>
      <h2 style={title}>DPS Compare</h2>

      <div className="card" style={barCard}>
        <label style={field}>
          <span style={label}>Skill type</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['attack', 'spell'] as Archetype[]).map((a) => (
              <button key={a} onClick={() => set('archetype', a)}
                style={{ padding: '4px 12px', textTransform: 'capitalize', border: `1px solid ${inp.archetype === a ? 'var(--gold)' : 'var(--bronze)'}`, color: inp.archetype === a ? 'var(--gold-bright)' : 'var(--text-muted)', background: inp.archetype === a ? 'rgba(77,208,225,0.12)' : 'transparent', borderRadius: 4, cursor: 'pointer' }}>
                {a}
              </button>
            ))}
          </div>
        </label>
        <Num label="Base hit" value={inp.baseHit} onChange={(n) => set('baseHit', n)} step={10} />
        <Num label={inp.archetype === 'attack' ? 'Attacks/sec' : 'Casts/sec'} value={inp.baseSpeed} onChange={(n) => set('baseSpeed', n)} step={0.05} />
        <Num label="Crit chance %" value={inp.baseCritChance} onChange={(n) => set('baseCritChance', n)} />
        <Num label="Crit dmg %" value={inp.baseCritMulti} onChange={(n) => set('baseCritMulti', n)} step={5} />
        <Num label="Projectiles" value={inp.projectiles} onChange={(n) => set('projectiles', n)} />
        <Num label="Base DoT/s" value={inp.baseDot} onChange={(n) => set('baseDot', n)} step={10} />
      </div>

      {ratio != null && (
        <div className="card" style={{ padding: 12, marginBottom: 14, textAlign: 'center' }}>
          Your current build does{' '}
          <span style={{ fontWeight: 700, color: ratio >= 1 ? 'var(--jade)' : 'var(--gold-bright)' }}>{Math.round(ratio * 100)}%</span>{' '}
          of the target's estimated DPS
          {ratio < 1 ? ` — about ${Math.round((1 / ratio - 1) * 100)}% more to reach it.` : ' — at or above the plan.'}
        </div>
      )}

      <div style={cols}>
        <BuildColumn heading="Your build (current)" res={curRes} profile={curProfile} arch={inp.archetype} />
        <BuildColumn heading={`Target · ${target?.name ?? ''}`} res={tgtRes} profile={tgtProfile} arch={inp.archetype} accent />
      </div>

      <div style={{ ...mutedS, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
        Estimate for planning, not an exact engine. Modifiers are parsed from passive-node stats and item mod text; skill base damage,
        conversions, support-gem multipliers and enemy stats aren't in the build data. The <b>index</b> (the modifier stack) is
        base-independent, so the current-vs-target comparison is reliable even though absolute DPS depends on the base you enter above.
      </div>
    </div>
  );
}

function BuildColumn({ heading, res, profile, arch, accent }: { heading: string; res: DpsResult | null; profile: DamageProfile | null; arch: Archetype; accent?: boolean }) {
  return (
    <div className="card" style={{ ...col, ...(accent ? { borderColor: 'var(--bronze-lit)' } : null) }}>
      <div style={colHead}>{heading}</div>
      {!res || !profile ? <div style={mutedS}>—</div> : (
        <>
          <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', marginBottom: 8 }}>
            <div><div style={label}>Damage index</div><div style={big}>{res.index.toFixed(2)}×</div></div>
            <div><div style={label}>Est. total DPS</div><div style={{ ...big, fontSize: 24, color: 'var(--gold-bright)' }}>{fmt(res.total)}</div></div>
          </div>
          <div style={statRow}><span style={mutedS}>Hit DPS</span><span>{fmt(res.hit)}</span></div>
          <div style={statRow}><span style={mutedS}>DoT DPS</span><span>{fmt(res.dot)}</span></div>
          <div style={statRow}><span style={mutedS}>Increased ({arch} hit)</span><span>{res.incHit}%</span></div>
          <div style={statRow}><span style={mutedS}>Increased (DoT)</span><span>{res.incDot}%</span></div>
          <div style={statRow}><span style={mutedS}>Crit multiplier</span><span>{res.effCrit.toFixed(3)}×</span></div>
          <div style={statRow}><span style={mutedS}>{arch === 'attack' ? 'Attack' : 'Cast'} speed</span><span>+{arch === 'attack' ? profile.attackSpeed : profile.castSpeed}%</span></div>
          <div style={{ ...mutedS, fontSize: 11, marginTop: 6 }}>
            {Object.entries(profile.increased).filter(([, v]) => v > 0).map(([k, v]) => `${k} +${v}%`).join(' · ') || 'no damage mods parsed'}
          </div>
        </>
      )}
    </div>
  );
}
