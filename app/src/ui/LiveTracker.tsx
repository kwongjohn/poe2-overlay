// Live progress readout + "plan vs actual" checklist, driven by the companion
// server's Client.txt watcher. Subscribes to /api/live (Server-Sent Events) for
// character/level/zone/deaths/session, and fetches /api/plan (the leveling plan
// for the currently-exported build) to show what you should have by your level
// and what unlocks next. Degrades quietly when the server or game log is absent.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../state';

const API = 'http://127.0.0.1:4517/api';

interface LiveState {
  connected: boolean;
  logPath: string | null;
  character: string | null;
  class: string | null;
  level: number | null;
  area: string | null;
  areaLevel: number | null;
  seed: number | null;
  deaths: number;
  lastDeathAt: string | null;
  sessionStart: number;
  updatedAt: number;
}

interface SkillEntry { label: string; from: number; supports: string[]; }
interface ItemEntry { slot: string; label: string; from: number; }
interface Plan {
  exported: boolean;
  file?: string;
  name?: string;
  ascendancy?: string | null;
  missing?: boolean;
  invalid?: boolean;
  passives?: { main: number; ascendancy: number };
  skills?: SkillEntry[];
  items?: ItemEntry[];
}

interface SlotItem { slot: string; label: string; }
interface Relink { skill: string; add: string[]; remove: string[]; }
interface Compare {
  exported: boolean;
  error?: string;
  file?: string;
  missing?: boolean;
  invalid?: boolean;
  name?: string;
  currentName?: string | null;
  inSync?: boolean;
  passives?: { planned: number; current: number; matched: number; toAllocate: number; toRefund: number };
  skills?: { toAdd: string[]; toRemove: string[]; relink: Relink[]; matched: number };
  items?: { toEquip: SlotItem[]; toRemove: SlotItem[]; matched: number };
}

interface HistLevel { level: number; ts: number; sincePrevMs: number | null; }
interface AreaCount { area: string; count: number; }
interface AreaMs { area: string; ms: number; }
interface HistSession { start: number; end: number; deaths: number; minLevel: number | null; maxLevel: number | null; }
interface History {
  events: number;
  character: string | null;
  totals?: {
    deaths: number; playtimeMs: number; sessions: number;
    firstSeen: number; lastSeen: number; minLevel: number | null; maxLevel: number | null;
  };
  levels?: HistLevel[];
  deathsByArea?: AreaCount[];
  timeByArea?: AreaMs[];
  sessions?: HistSession[];
}

const wrap: CSSProperties = {
  position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '3px 12px',
  fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text)',
  border: '1px solid var(--bronze)', borderRadius: 4,
  background: 'rgba(22,27,34,0.6)', whiteSpace: 'nowrap',
};
const dot = (on: boolean): CSSProperties => ({
  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  background: on ? 'var(--gold-bright, #c8a86a)' : 'var(--text-muted)',
  boxShadow: on ? '0 0 6px rgba(77,208,225,0.7)' : 'none',
});
const muted: CSSProperties = { color: 'var(--text-muted)' };
const strong: CSSProperties = { color: 'var(--gold-bright, #c8a86a)', fontWeight: 700 };
const sep: CSSProperties = { color: 'rgba(139,148,158,0.4)' };
const caret: CSSProperties = { color: 'var(--text-muted)', fontSize: 10, marginLeft: 2 };

const panel: CSSProperties = {
  position: 'absolute', top: 40, left: 0, zIndex: 50, width: 380, maxHeight: 460,
  overflowY: 'auto', padding: 12, whiteSpace: 'normal',
  background: 'linear-gradient(180deg, rgba(28,35,44,0.99), rgba(13,17,23,0.99))',
  border: '1px solid var(--bronze)', borderRadius: 4,
  boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
};
const sectionTitle: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)', margin: '12px 0 6px',
};
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0',
  borderBottom: '1px solid rgba(48,54,61,0.7)',
};
const lvlBadge = (have: boolean, next: boolean): CSSProperties => ({
  flexShrink: 0, minWidth: 34, textAlign: 'center', fontSize: 11, borderRadius: 3,
  padding: '1px 5px', fontFamily: 'var(--font-display)',
  border: `1px solid ${next ? 'var(--gold)' : have ? 'var(--bronze)' : 'rgba(110,118,129,0.4)'}`,
  color: next ? 'var(--gold-bright, #c8a86a)' : have ? 'var(--text)' : 'var(--text-muted)',
  background: next ? 'rgba(77,208,225,0.12)' : 'transparent',
});

const tabRow: CSSProperties = { display: 'flex', gap: 6, marginBottom: 4 };
const tabBtn = (active: boolean): CSSProperties => ({
  flex: 1, padding: '4px 0', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
  fontFamily: 'var(--font-display)', cursor: 'pointer', borderRadius: 3,
  border: `1px solid ${active ? 'var(--gold)' : 'var(--bronze)'}`,
  color: active ? 'var(--gold-bright, #c8a86a)' : 'var(--text-muted)',
  background: active ? 'rgba(77,208,225,0.12)' : 'transparent',
});
const statGrid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '4px 16px', margin: '4px 0 2px' };
const barTrack: CSSProperties = { flex: 1, height: 6, borderRadius: 3, background: 'rgba(110,118,129,0.18)', overflow: 'hidden' };

function prettyArea(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
}
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
// Compact span that keeps seconds/minutes readable for short intervals.
function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PlanRow({ label, from, level, nextLevel, sub }: {
  label: string; from: number; level: number; nextLevel: number | null; sub?: string;
}) {
  const have = from <= level;
  const next = from === nextLevel;
  return (
    <div style={rowStyle}>
      <span style={lvlBadge(have, next)}>L{from}</span>
      <span style={{ flex: 1, color: have ? 'var(--text)' : 'var(--text-muted)' }}>
        {have ? '✓ ' : ''}{label}
        {sub ? <div style={{ ...muted, fontSize: 11, marginTop: 1 }}>{sub}</div> : null}
      </span>
    </div>
  );
}

export default function LiveTracker() {
  const [state, setState] = useState<LiveState | null>(null);
  const [reachable, setReachable] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'plan' | 'compare' | 'history'>('plan');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const serialize = useStore((s) => s.serialize);

  useEffect(() => {
    const es = new EventSource(`${API}/live`);
    esRef.current = es;
    es.addEventListener('state', (e) => {
      setReachable(true);
      try { setState(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
    });
    es.onopen = () => setReachable(true);
    es.onerror = () => setReachable(false); // EventSource auto-reconnects
    return () => es.close();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const loadPlan = useCallback(async () => {
    try { setPlan(await (await fetch(`${API}/plan`)).json()); } catch { setPlan(null); }
  }, []);
  const loadHistory = useCallback(async () => {
    try { setHistory(await (await fetch(`${API}/history`)).json()); } catch { setHistory(null); }
  }, []);
  // Compare the build currently open in the editor against the exported plan.
  const loadCompare = useCallback(async () => {
    try {
      const r = await fetch(`${API}/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serialize() });
      setCompare(await r.json());
    } catch { setCompare(null); }
  }, [serialize]);

  // Fetch the active tab's data whenever the panel is open (picks up new exports/edits/events).
  // Overview also pulls history so its recommendations can combine plan gaps + play data.
  useEffect(() => {
    if (!open) return;
    if (tab === 'plan') void loadPlan();
    else if (tab === 'compare') { void loadCompare(); void loadHistory(); }
    else void loadHistory();
  }, [open, tab, loadPlan, loadCompare, loadHistory]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const levelKnown = state?.level != null;
  const level = state?.level ?? 0;
  // We're clearly in-game once the log yields any signal — a zone or a character.
  // The name/level only appear from a level-up or death, so a zone may come first.
  const hasSignal = !!state && state.connected && (state.character != null || state.area != null);

  // Pill contents by connection/game state.
  let pill: ReactNode;
  if (!reachable) {
    return <div style={{ ...wrap, ...muted }} title="Start the app with npm start">tracker offline</div>;
  } else if (!state || !state.connected) {
    pill = <><span style={dot(false)} /><span style={muted}>no game log</span></>;
  } else if (!hasSignal) {
    pill = <><span style={dot(true)} /><span style={muted}>waiting for game…</span></>;
  } else {
    pill = (
      <>
        <span style={dot(true)} />
        {state.character
          ? <span style={strong}>{state.character}</span>
          : <span style={muted}>in game</span>}
        {state.class && <span style={muted}>{state.class}</span>}
        {levelKnown && (
          <>
            <span style={sep}>·</span>
            <span>L<span style={strong}>{state.level}</span></span>
          </>
        )}
        {state.area && (
          <>
            <span style={sep}>·</span>
            <span>{prettyArea(state.area)}{state.areaLevel ? <span style={muted}> ({state.areaLevel})</span> : null}</span>
          </>
        )}
        <span style={sep}>·</span>
        <span title={state.lastDeathAt ? `Last death: ${state.lastDeathAt}` : ''}>
          <span style={muted}>deaths </span>{state.deaths}
        </span>
        <span style={sep}>·</span>
        <span style={muted}>{fmtDuration(now - state.sessionStart)}</span>
      </>
    );
  }

  return (
    <div style={{ ...wrap, cursor: 'pointer' }} onClick={toggle} title="Plan vs actual for the exported build">
      {pill}
      <span style={caret}>{open ? '▲' : '▼'}</span>
      {open && (
        <div style={panel} onClick={(e) => e.stopPropagation()}>
          <div style={tabRow}>
            <button style={tabBtn(tab === 'plan')} onClick={() => setTab('plan')}>Plan</button>
            <button style={tabBtn(tab === 'compare')} onClick={() => setTab('compare')}>Overview</button>
            <button style={tabBtn(tab === 'history')} onClick={() => setTab('history')}>History</button>
          </div>
          {tab === 'plan' && <PlanPanel plan={plan} level={level} inGame={hasSignal} levelKnown={levelKnown} />}
          {tab === 'compare' && <ComparePanel compare={compare} history={history} live={state} onRefresh={() => { void loadCompare(); void loadHistory(); }} />}
          {tab === 'history' && <HistoryPanel history={history} />}
        </div>
      )}
    </div>
  );
}

function PlanPanel({ plan, level, inGame, levelKnown }: { plan: Plan | null; level: number; inGame: boolean; levelKnown: boolean }) {
  if (!plan) return <div style={muted}>Loading plan…</div>;
  if (!plan.exported) {
    const why = plan.missing
      ? `Exported file no longer in the game folder (${plan.file}).`
      : plan.invalid
        ? 'The exported build could not be parsed.'
        : 'No target build set. Library → Target on the build you want to follow.';
    return <div style={muted}>{why}</div>;
  }

  const skills = plan.skills ?? [];
  const items = plan.items ?? [];
  // Only diff against the level once we actually know it (learned on a level-up
  // or death). Until then, list the plan without ✓ / next-up so we don't imply a
  // wrong level for an existing character.
  const diff = inGame && levelKnown;
  const effLevel = diff ? level : -1; // -1 => nothing marked "have"
  const froms = [...skills.map((s) => s.from), ...items.map((i) => i.from)].filter((f) => f > effLevel);
  const nextLevel = diff && froms.length ? Math.min(...froms) : null;
  const nextSkills = skills.filter((s) => s.from === nextLevel);
  const nextItems = items.filter((i) => i.from === nextLevel);

  const status = !inGame
    ? 'launch game to track your level'
    : levelKnown
      ? undefined
      : 'in game · level shows after your next level-up or death';

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ ...strong, fontSize: 14 }}>{plan.name}</div>
      <div style={muted}>
        {plan.ascendancy ? `${plan.ascendancy} · ` : ''}
        {status ?? <>your level <span style={strong}>{level}</span></>}
      </div>

      {diff && (
        <>
          <div style={sectionTitle}>Next up{nextLevel != null ? ` · at level ${nextLevel}` : ''}</div>
          {nextLevel == null ? (
            <div style={muted}>✓ All planned skills &amp; gear are unlocked for your level.</div>
          ) : (
            <>
              {nextSkills.map((s) => <PlanRow key={`ns-${s.label}`} label={s.label} from={s.from} level={effLevel} nextLevel={nextLevel} sub={s.supports.length ? s.supports.join(', ') : undefined} />)}
              {nextItems.map((i) => <PlanRow key={`ni-${i.slot}-${i.label}`} label={`${i.slot}: ${i.label}`} from={i.from} level={effLevel} nextLevel={nextLevel} />)}
            </>
          )}
        </>
      )}

      <div style={sectionTitle}>Skills ({skills.length})</div>
      {skills.map((s) => <PlanRow key={`s-${s.label}`} label={s.label} from={s.from} level={effLevel} nextLevel={nextLevel} sub={s.supports.length ? s.supports.join(', ') : undefined} />)}

      <div style={sectionTitle}>Gear ({items.length})</div>
      {items.map((i) => <PlanRow key={`i-${i.slot}-${i.label}`} label={`${i.slot}: ${i.label}`} from={i.from} level={effLevel} nextLevel={nextLevel} />)}

      {plan.passives && (
        <>
          <div style={sectionTitle}>Passives</div>
          <div style={muted}>
            {plan.passives.main} passive + {plan.passives.ascendancy} ascendancy nodes planned.
            No per-level timing in this build — Load it to view the full tree.
          </div>
        </>
      )}
    </div>
  );
}

interface Rec { sev: 0 | 1 | 2; text: string }

// Personalized advice from what we know: plan gaps (compare) + play data (history)
// + live state. This is the thing generic guides can't do — it's about your character.
function computeRecs(compare: Compare | null, history: History | null, live: LiveState | null): Rec[] {
  const recs: Rec[] = [];
  if (compare?.exported && compare.passives && compare.skills && compare.items) {
    const p = compare.passives, sk = compare.skills, it = compare.items;
    if (p.toAllocate > 0) recs.push({ sev: p.toAllocate > 15 ? 2 : 1, text: `Allocate ${p.toAllocate} more passive node${p.toAllocate > 1 ? 's' : ''} to match the plan.` });
    if (sk.toAdd.length) recs.push({ sev: 1, text: `Slot planned gem${sk.toAdd.length > 1 ? 's' : ''}: ${sk.toAdd.slice(0, 3).join(', ')}${sk.toAdd.length > 3 ? '…' : ''}.` });
    if (it.toEquip.length) recs.push({ sev: 1, text: `Equip planned gear: ${it.toEquip.slice(0, 3).map((x) => x.slot).join(', ')}${it.toEquip.length > 3 ? '…' : ''}.` });
    if (p.toRefund > 5) recs.push({ sev: 0, text: `${p.toRefund} allocated nodes aren't in the plan — consider a respec.` });
  }
  const top = history?.deathsByArea?.[0];
  if (top && top.count >= 3) {
    recs.push({ sev: top.count >= 6 ? 2 : 1, text: `Deadliest zone: ${prettyArea(top.area)} (${top.count} deaths) — shore up defenses before returning.` });
    if (live?.area && live.area === top.area) recs.push({ sev: 2, text: `You're back in ${prettyArea(top.area)}, your deadliest zone — play carefully.` });
  }
  if ((history?.totals?.deaths ?? 0) >= 5 && compare?.passives && compare.passives.toAllocate > 10) {
    const behind = Math.round((1 - compare.passives.matched / Math.max(1, compare.passives.planned)) * 100);
    recs.push({ sev: 2, text: `You're dying often and ~${behind}% behind the planned tree — catching up may help survivability.` });
  }
  // Dedupe by text, strongest first, cap.
  const seen = new Set<string>();
  return recs.sort((a, b) => b.sev - a.sev).filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true))).slice(0, 5);
}

// At-a-glance overview + personalized advice. The full side-by-side lives on each
// category screen's Edit | Compare toggle; this summarizes how the build fares.
function ComparePanel({ compare, history, live, onRefresh }: { compare: Compare | null; history: History | null; live: LiveState | null; onRefresh: () => void }) {
  if (!compare) return <div style={muted}>Comparing…</div>;
  if (compare.error) return <div style={muted}>Current build: {compare.error}</div>;
  if (!compare.exported) {
    const why = compare.missing
      ? `Exported file no longer in the game folder (${compare.file}).`
      : compare.invalid
        ? 'The exported build could not be parsed.'
        : 'No target build set. Library → Target on the build you want to follow.';
    return <div style={muted}>{why}</div>;
  }
  const p = compare.passives!;
  const sk = compare.skills!;
  const it = compare.items!;
  const pct = p.planned > 0 ? Math.round((p.matched / p.planned) * 100) : 0;
  const skNotes = [sk.toAdd.length ? `${sk.toAdd.length} to add` : '', sk.relink.length ? `${sk.relink.length} to re-link` : '', sk.toRemove.length ? `${sk.toRemove.length} off-plan` : ''].filter(Boolean).join(' · ');
  const itNotes = [it.toEquip.length ? `${it.toEquip.length} to equip` : '', it.toRemove.length ? `${it.toRemove.length} off-plan` : ''].filter(Boolean).join(' · ');
  const recs = computeRecs(compare, history, live);

  const Line = ({ label, matched, total, notes }: { label: string; matched: number; total: number; notes: string }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
      <span style={{ width: 66 }}>{label}</span>
      <span><span style={strong}>{matched}</span><span style={muted}>/{total}</span></span>
      <span style={{ ...muted, fontSize: 12, flex: 1, textAlign: 'right' }}>{notes || '✓ match'}</span>
    </div>
  );

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...strong, fontSize: 14, flex: 1 }}>Overview</span>
        <button style={{ ...tabBtn(false), flex: 'none', padding: '2px 8px' }} onClick={onRefresh}>Refresh</button>
      </div>
      <div style={muted}>
        {compare.currentName ? `“${compare.currentName}”` : 'editor build'} vs {compare.name}
      </div>

      <div style={sectionTitle}>Advice</div>
      {recs.length === 0
        ? <div style={{ color: 'var(--jade)', fontSize: 13 }}>✓ On track — nothing to flag right now.</div>
        : recs.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, padding: '3px 0', fontSize: 12.5, lineHeight: 1.4 }}>
              <span style={{ color: r.sev === 2 ? 'var(--blood-lit)' : r.sev === 1 ? 'var(--gold)' : 'var(--text-muted)', fontWeight: 700 }}>{r.sev === 2 ? '!' : r.sev === 1 ? '›' : '·'}</span>
              <span style={{ flex: 1 }}>{r.text}</span>
            </div>
          ))}

      <div style={sectionTitle}>Passives · {p.matched}/{p.planned} nodes</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
        <span style={barTrack}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--gold)' }} /></span>
        <span style={{ ...muted, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
      </div>

      <div style={sectionTitle}>Skills &amp; gear</div>
      <Line label="Skills" matched={sk.matched} total={sk.matched + sk.toAdd.length} notes={skNotes} />
      <Line label="Gear" matched={it.matched} total={it.matched + it.toEquip.length} notes={itNotes} />

      <div style={{ ...muted, fontSize: 11, marginTop: 10 }}>
        Open a category screen (Skills / Passive Tree / Items) and switch to <b>Compare</b> for the side-by-side detail.
      </div>

      <AccountSection />
    </div>
  );
}

interface AuthStatus {
  configured: boolean; connected: boolean; username: string | null;
  expiresAt: number | null; scope: string | null; redirectUri: string; contactSet: boolean;
}

// Self-contained GGG account connect/status. The API becomes the automatic
// "current character" source once connected (character→build mapping is next).
function AccountSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [chars, setChars] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const s: AuthStatus = await (await fetch(`${API}/auth/status`)).json();
      setStatus(s);
      if (s.connected) {
        try {
          const data = await (await fetch(`${API}/characters`)).json();
          const list = Array.isArray(data) ? data : (data.characters ?? []);
          setChars(list.map((c: { name?: string }) => c.name ?? String(c)).filter(Boolean));
        } catch { setChars(null); }
      } else setChars(null);
    } catch { setStatus(null); }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load(); // re-check after returning from the GGG consent tab
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const disconnect = useCallback(async () => {
    await fetch(`${API}/auth/logout`, { method: 'POST' }).catch(() => {});
    void load();
  }, [load]);

  if (!status) return null;
  return (
    <>
      <div style={sectionTitle}>GGG account</div>
      {!status.configured ? (
        <div style={muted}>Not set up — register a GGG app (scope <code>account:characters</code>), then add the client id in settings. See the setup notes.</div>
      ) : !status.connected ? (
        <div>
          <button style={{ ...tabBtn(false), padding: '4px 12px' }} onClick={() => window.open(`${API}/auth/login`, '_blank', 'noopener')}>Connect account</button>
          <div style={{ ...muted, fontSize: 11, marginTop: 4 }}>Opens GGG sign-in; approve, then return here.</div>
        </div>
      ) : (
        <div>
          <div>Connected as <span style={strong}>{status.username ?? 'your account'}</span> <button style={{ ...tabBtn(false), padding: '1px 8px', marginLeft: 6 }} onClick={disconnect}>Disconnect</button></div>
          {chars && chars.length > 0 && <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>PoE2 characters: {chars.join(', ')}</div>}
          <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>Auto-import of your live character into Compare is the next step.</div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <span><span style={muted}>{label} </span><span style={strong}>{value}</span></span>;
}

// Horizontal bar row for the "by zone" breakdowns.
function BarRow({ label, value, num, max, accent }: { label: string; value: string; num: number; max: number; accent: boolean }) {
  const pct = max > 0 ? Math.max(4, Math.round((num / max) * 100)) : 0;
  return (
    <div style={{ ...rowStyle, gap: 8 }}>
      <span style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={barTrack}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: accent ? 'var(--gold)' : 'var(--bronze)' }} />
      </span>
      <span style={{ ...muted, minWidth: 48, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function HistoryPanel({ history }: { history: History | null }) {
  if (!history) return <div style={muted}>Loading history…</div>;
  if (!history.events || !history.totals) {
    return <div style={muted}>No sessions recorded yet — play with the tracker running and your progress shows up here.</div>;
  }
  const t = history.totals;
  const levels = (history.levels ?? []).filter((l) => l.sincePrevMs != null).slice(-8).reverse();
  const deaths = (history.deathsByArea ?? []).slice(0, 6);
  const times = (history.timeByArea ?? []).slice(0, 6);
  const sessions = (history.sessions ?? []).slice(-5).reverse();
  const maxDeath = deaths.reduce((m, d) => Math.max(m, d.count), 0);
  const maxTime = times.reduce((m, x) => Math.max(m, x.ms), 0);

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ ...strong, fontSize: 14 }}>{history.character ?? 'History'}</div>
      <div style={statGrid}>
        <Stat label="playtime" value={fmtDuration(t.playtimeMs)} />
        <Stat label="sessions" value={String(t.sessions)} />
        <Stat label="deaths" value={String(t.deaths)} />
        {t.minLevel != null && <Stat label="levels" value={`${t.minLevel}→${t.maxLevel}`} />}
      </div>

      <div style={sectionTitle}>Time to level (recent)</div>
      {levels.length === 0
        ? <div style={muted}>Not enough level-ups recorded yet.</div>
        : levels.map((l) => (
            <div key={`lv-${l.level}`} style={rowStyle}>
              <span style={lvlBadge(true, false)}>L{l.level}</span>
              <span style={{ flex: 1, ...muted }}>reached in</span>
              <span>{fmtSpan(l.sincePrevMs as number)}</span>
            </div>
          ))}

      <div style={sectionTitle}>Deaths by zone</div>
      {deaths.length === 0
        ? <div style={muted}>No deaths recorded. Nice.</div>
        : deaths.map((d) => <BarRow key={`d-${d.area}`} label={prettyArea(d.area)} value={String(d.count)} num={d.count} max={maxDeath} accent />)}

      <div style={sectionTitle}>Time by zone</div>
      {times.length === 0
        ? <div style={muted}>Not enough zone changes recorded yet.</div>
        : times.map((x) => <BarRow key={`t-${x.area}`} label={prettyArea(x.area)} value={fmtSpan(x.ms)} num={x.ms} max={maxTime} accent={false} />)}

      <div style={sectionTitle}>Recent sessions</div>
      {sessions.map((s, i) => (
        <div key={`ses-${s.start}-${i}`} style={rowStyle}>
          <span style={{ flex: 1 }}>{fmtDate(s.start)}</span>
          <span style={muted}>{fmtDuration(s.end - s.start)}</span>
          {s.minLevel != null && <span style={sep}>·</span>}
          {s.minLevel != null && <span>L{s.minLevel}{s.maxLevel !== s.minLevel ? `→${s.maxLevel}` : ''}</span>}
          <span style={sep}>·</span>
          <span style={muted}>{s.deaths} deaths</span>
        </div>
      ))}
    </div>
  );
}
