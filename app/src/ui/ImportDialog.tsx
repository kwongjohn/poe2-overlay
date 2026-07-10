// Import a build into the library from a Path of Building export code or a raw
// .build JSON. Decoding/mapping happens server-side (/api/import); this is the
// paste box + result/warnings. Great for pulling in a Mobalytics/PoB guide to
// then set as your compare target.
import { useState } from 'react';
import type { CSSProperties } from 'react';

const API = 'http://127.0.0.1:4517/api';

interface ImportResult {
  ok?: boolean;
  error?: string;
  file?: string;
  name?: string;
  warnings?: string[];
  stats?: { passives: number; skills: number; items: number };
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(1,4,9,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const dialog: CSSProperties = {
  width: 560, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', padding: 20,
  background: 'linear-gradient(180deg, rgba(28,35,44,0.99), rgba(13,17,23,0.99))',
  border: '1px solid var(--bronze)', borderRadius: 6, boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
  fontFamily: 'var(--font-body)', color: 'var(--text)', fontSize: 13,
};
const h: CSSProperties = { margin: '0 0 4px', fontSize: 18, color: 'var(--gold-bright)' };
const ta: CSSProperties = { width: '100%', minHeight: 130, marginTop: 10, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' };
const rowEnd: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 };

export default function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (file: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const doImport = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`${API}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: text }) });
      const j: ImportResult = await r.json();
      setResult(j);
      if (j.ok && j.file) onImported(j.file);
    } catch {
      setResult({ error: 'companion server unreachable' });
    }
    setBusy(false);
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={h}>Import build</h3>
        <div style={{ color: 'var(--text-muted)' }}>
          Paste a <b>Path of Building</b> export code, or the JSON from a <b>.build</b> file. It's added to your library — then click <b>Target</b> on it to compare against.
        </div>
        <textarea style={ta} value={text} onChange={(e) => setText(e.target.value)} placeholder="Path of Building code or .build JSON…" />
        <div style={rowEnd}>
          <button className="btn-label" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => void doImport()} disabled={busy || !text.trim()}>{busy ? 'Importing…' : 'Import'}</button>
        </div>
        {result && (
          result.ok ? (
            <div style={{ marginTop: 12, padding: 10, border: '1px solid var(--line)', borderRadius: 4 }}>
              <div style={{ color: 'var(--jade)' }}>✓ Imported “{result.name}”.</div>
              {result.stats && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{result.stats.passives} passives · {result.stats.skills} skills · {result.stats.items} items</div>}
              {result.warnings && result.warnings.length > 0 && (
                <div style={{ color: 'var(--gold)', marginTop: 6, fontSize: 12 }}>
                  {result.warnings.map((w, i) => <div key={i}>› {w}</div>)}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 12, color: 'var(--blood-lit)' }}>✗ {result.error}</div>
          )
        )}
      </div>
    </div>
  );
}
