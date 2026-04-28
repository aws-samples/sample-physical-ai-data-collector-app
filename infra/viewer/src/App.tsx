import { useState, useEffect } from 'react';
import LoginGate from './components/LoginGate';
import CaptureList from './pages/CaptureList';
import CaptureDetail from './pages/CaptureDetail';
import { getUser, logout } from './auth';
import type { CaptureItem } from './api';

// ── hash routing helpers ──────────────────────────────────────────────────────
function getPkFromHash(): string | null {
  const m = window.location.hash.match(/^#capture\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function setHash(pk: string | null) {
  window.location.hash = pk ? `capture/${encodeURIComponent(pk)}` : '';
}

export default function App() {
  const [selected, setSelected] = useState<CaptureItem | null>(null);
  // captures cache so we can restore from hash on load / back-navigation
  const [capturesCache, setCapturesCache] = useState<CaptureItem[]>([]);
  const user = getUser();

  // ── sync state → URL ────────────────────────────────────────────────────────
  const selectCapture = (item: CaptureItem | null) => {
    setSelected(item);
    setHash(item?.pk ?? null);
  };

  // ── sync URL → state (back / forward / direct link / hard refresh) ─────────
  useEffect(() => {
    const onHashChange = () => {
      const pk = getPkFromHash();
      if (!pk) {
        setSelected(null);
        return;
      }
      // try to restore from cache first; fall back to a pk-only stub so that
      // CaptureDetail (which only needs capture.pk for its API calls) renders
      // immediately even on a hard refresh where the cache is empty.
      const cached = capturesCache.find(c => c.pk === pk);
      setSelected(cached ?? {
        pk,
        capturedAt: 0,
        scenario: '',
        location: '',
        taskType: '',
        deviceId: '',
        s3Key: '',
        labelStatus: '',
        labelQuality: '',
        labelTags: [],
        labelNotes: '',
      });
    };

    window.addEventListener('hashchange', onHashChange);
    // handle direct load with a hash (including hard refresh)
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [capturesCache]);

  return (
    <LoginGate>
      <div className="min-h-screen flex flex-col bg-[#0d1117]">
        {/* ── Top nav ── */}
        <header className="border-b border-[#252d3d] bg-[#0d1117] px-6 flex items-center gap-6 h-14 shrink-0">
          {/* Logo – click to go to root */}
          <button
            onClick={() => selectCapture(null)}
            className="flex items-center gap-2.5 select-none hover:opacity-80 transition-opacity"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-sky-400 shrink-0" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20 L8 8 L12 14 L16 6 L22 20" />
              <circle cx="16" cy="6" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            <span className="font-mono text-sky-400 font-semibold text-sm tracking-widest uppercase">
              PAI Data Viewer
            </span>
          </button>

          <div className="h-5 w-px bg-[#252d3d]" />

          {/* Breadcrumb */}
          {selected ? (
            <nav className="flex items-center gap-2 text-sm text-slate-400">
              <button
                onClick={() => selectCapture(null)}
                className="hover:text-sky-400 transition-colors"
              >
                Captures
              </button>
              <span>/</span>
              <span className="text-slate-200 truncate max-w-xs">
                {selected.scenario
                  ? `${selected.scenario} · ${new Date(selected.capturedAt).toLocaleDateString()}`
                  : <span className="text-slate-400 font-mono text-xs">{selected.pk.slice(0, 24)}…</span>
                }
              </span>
            </nav>
          ) : (
            <span className="text-sm text-slate-400">Captures</span>
          )}

          {/* Spacer + user */}
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400 select-none">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-500 shrink-0"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
                {user.username}
              </span>
            )}
            <div className="h-4 w-px bg-[#252d3d]" />
            <button
              onClick={logout}
              className="text-xs text-slate-500 hover:text-slate-200 transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="flex-1 overflow-hidden">
          {selected ? (
            <CaptureDetail capture={selected} onBack={() => selectCapture(null)} />
          ) : (
            <CaptureList
              onSelect={item => {
                // keep a local cache so hash→state restore works after back-nav
                setCapturesCache(prev =>
                  prev.some(c => c.pk === item.pk) ? prev : [...prev, item]
                );
                selectCapture(item);
              }}
            />
          )}
        </main>
      </div>
    </LoginGate>
  );
}
