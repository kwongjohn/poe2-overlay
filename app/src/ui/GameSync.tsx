// Companion-server integration: build library + one-click export into the
// game's BuildPlanner folder. Degrades gracefully when the server is offline.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../state';
import { parseBuild } from '../buildfile';
import ImportDialog from './ImportDialog';

const API = 'http://127.0.0.1:4517/api';

interface LibraryEntry {
  file: string;
  modified: number;
  exported?: boolean;
  target?: boolean;
  invalid?: boolean;
  name?: string;
  ascendancy?: string;
  author?: string;
}

const wrap: CSSProperties = {
  position: 'relative', display: 'flex', gap: 8, alignItems: 'center',
  fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text)',
};
const panel: CSSProperties = {
  position: 'absolute', top: 44, right: 0, zIndex: 50, minWidth: 340, maxHeight: 420,
  overflowY: 'auto', padding: 10,
  background: 'linear-gradient(180deg, rgba(28,35,44,0.99), rgba(13,17,23,0.99))',
  border: '1px solid var(--bronze)', borderRadius: 4,
  boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
};
const row: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
  borderBottom: '1px solid rgba(48,54,61,0.7)',
};
const rowName: CSSProperties = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const smallBtn: CSSProperties = {
  background: 'none', border: '1px solid var(--bronze)', borderRadius: 3,
  color: 'var(--text)', cursor: 'pointer', fontSize: 11, padding: '2px 8px',
};
const statusStyle: CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap',
  maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
};

export default function GameSync() {
  const serialize = useStore((s) => s.serialize);
  const loadBuild = useStore((s) => s.loadBuild);
  const buildName = useStore((s) => s.build.name);

  const [online, setOnline] = useState(false);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [status, setStatus] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(''), 4000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch(`${API}/health`);
        if (!cancelled) setOnline(r.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    check();
    const id = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}/builds`);
      setEntries(await r.json());
    } catch {
      setEntries([]);
    }
  }, []);

  const toggleLibrary = useCallback(() => {
    setOpen((o) => {
      if (!o) void refresh();
      return !o;
    });
  }, [refresh]);

  const fileForCurrent = () => `${(buildName || 'untitled').trim() || 'untitled'}.build`;

  const saveToLibrary = useCallback(async () => {
    try {
      const file = encodeURIComponent(fileForCurrent());
      const r = await fetch(`${API}/builds/${file}`, { method: 'PUT', body: serialize() });
      const j = await r.json();
      flash(r.ok ? `Saved to library: ${j.saved}` : `Save failed: ${(j.details || [j.error]).join('; ')}`);
      if (open) void refresh();
    } catch {
      flash('Save failed: companion server unreachable');
    }
  }, [serialize, buildName, open, refresh, flash]);

  const exportCurrent = useCallback(async () => {
    try {
      const r = await fetch(`${API}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: serialize(), name: buildName }),
      });
      const j = await r.json();
      flash(r.ok ? `In game folder: ${j.exported}` : `Export failed: ${(j.details || [j.error]).join('; ')}`);
    } catch {
      flash('Export failed: companion server unreachable');
    }
  }, [serialize, buildName, flash]);

  const loadEntry = useCallback(async (file: string) => {
    try {
      const r = await fetch(`${API}/builds/${encodeURIComponent(file)}`);
      if (!r.ok) { flash('Load failed'); return; }
      loadBuild(parseBuild(await r.text()));
      setOpen(false);
      flash(`Loaded: ${file}`);
    } catch {
      flash('Load failed: companion server unreachable');
    }
  }, [loadBuild, flash]);

  const exportEntry = useCallback(async (file: string) => {
    try {
      const r = await fetch(`${API}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      });
      const j = await r.json();
      flash(r.ok ? `In game folder: ${j.exported}` : `Export failed: ${j.error}`);
      void refresh();
    } catch {
      flash('Export failed: companion server unreachable');
    }
  }, [refresh, flash]);

  const deleteEntry = useCallback(async (file: string) => {
    await fetch(`${API}/builds/${encodeURIComponent(file)}`, { method: 'DELETE' }).catch(() => {});
    void refresh();
  }, [refresh]);

  // Set / clear this build as the compare target (the plan). Independent of export.
  const toggleTarget = useCallback(async (entry: LibraryEntry) => {
    try {
      if (entry.target) {
        await fetch(`${API}/target`, { method: 'DELETE' });
        flash('Compare target cleared');
      } else {
        const r = await fetch(`${API}/target`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: entry.file }) });
        flash(r.ok ? `Compare target: ${entry.name || entry.file}` : 'Could not set target');
      }
      void refresh();
    } catch {
      flash('Set target failed: companion server unreachable');
    }
  }, [refresh, flash]);

  if (!online) {
    return <div style={wrap}><span style={statusStyle} title="Start it with: npm start">companion offline</span></div>;
  }

  return (
    <div style={wrap}>
      {status && <span style={statusStyle}>{status}</span>}
      <button className="btn-label" onClick={toggleLibrary}>Library</button>
      <button className="btn-label" onClick={() => setImporting(true)} title="Import a Path of Building code or a .build file">Import</button>
      <button className="btn-label" onClick={saveToLibrary}>Save to Library</button>
      <button className="btn-primary" onClick={exportCurrent} title="Write this build into the game's BuildPlanner folder">
        Export to Game
      </button>
      {open && (
        <div style={panel}>
          {entries.length === 0 && <div style={{ color: 'var(--text-muted)', padding: 6 }}>Library is empty.</div>}
          {entries.map((e) => (
            <div key={e.file} style={row}>
              <span style={rowName} title={e.file}>
                {e.target ? '🎯 ' : ''}{e.exported ? '⭐ ' : ''}{e.name || e.file}
                {e.ascendancy ? <span style={{ color: 'var(--text-muted)' }}> · {e.ascendancy}</span> : null}
              </span>
              <button style={smallBtn} onClick={() => void loadEntry(e.file)} title="Open in the editor (becomes 'current')">Load</button>
              <button
                style={{ ...smallBtn, ...(e.target ? { borderColor: 'var(--gold)', color: 'var(--gold-bright)' } : null) }}
                onClick={() => void toggleTarget(e)}
                title={e.target ? 'This is the compare target — click to clear' : 'Set as the compare target (the plan)'}
              >
                {e.target ? 'Target ✓' : 'Target'}
              </button>
              <button style={smallBtn} onClick={() => void exportEntry(e.file)} title="Write into the game's BuildPlanner folder">Export</button>
              <button style={{ ...smallBtn, color: 'var(--text-muted)' }} onClick={() => void deleteEntry(e.file)} title="Delete from library">✕</button>
            </div>
          ))}
        </div>
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={() => { setOpen(true); void refresh(); flash('Imported to library'); }}
        />
      )}
    </div>
  );
}
