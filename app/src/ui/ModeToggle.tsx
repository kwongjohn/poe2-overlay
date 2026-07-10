// Small Edit / Compare segmented toggle used by the category screens to switch
// between editing the current build and the side-by-side comparison vs the plan.
import type { CSSProperties } from 'react';

export type Mode = 'edit' | 'compare';

const rowS: CSSProperties = { display: 'inline-flex', gap: 4 };
const btn = (active: boolean): CSSProperties => ({
  padding: '4px 14px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
  fontFamily: 'var(--font-display)', cursor: 'pointer', borderRadius: 4,
  border: `1px solid ${active ? 'var(--gold)' : 'var(--bronze)'}`,
  color: active ? 'var(--gold-bright)' : 'var(--text-muted)',
  background: active ? 'rgba(77,208,225,0.12)' : 'transparent',
});

export default function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div style={rowS}>
      <button style={btn(mode === 'edit')} onClick={() => onChange('edit')}>Edit</button>
      <button style={btn(mode === 'compare')} onClick={() => onChange('compare')}>Compare</button>
    </div>
  );
}
