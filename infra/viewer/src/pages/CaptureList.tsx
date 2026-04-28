import { useEffect, useState, useCallback } from 'react';
import { listCaptures } from '../api';
import type { CaptureItem } from '../api';
import CaptureCard from '../components/CaptureCard';

const STATUSES  = ['', 'pending', 'in-review', 'approved', 'rejected'];
const SCENARIOS = ['', 'logistics', 'assembly', 'welding', 'autonomous', 'inspection', 'other'];

interface Props {
  onSelect: (c: CaptureItem) => void;
}

export default function CaptureList({ onSelect }: Props) {
  const [items, setItems]       = useState<CaptureItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [status, setStatus]     = useState('');
  const [scenario, setScenario] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listCaptures({ limit: 100, status: status || undefined, scenario: scenario || undefined });
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load captures');
    } finally {
      setLoading(false);
    }
  }, [status, scenario]);

  useEffect(() => { load(); }, [load]);

  // Stats
  const total    = items.length;
  const pending  = items.filter(i => !i.labelStatus || i.labelStatus === 'pending').length;
  const approved = items.filter(i => i.labelStatus === 'approved').length;

  return (
    <div className="flex h-full">
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 border-r border-[#252d3d] bg-[#0d1117] p-4 flex flex-col gap-5">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Filters</p>

          <label className="block text-xs text-slate-400 mb-1">Status</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="input mb-3"
          >
            {STATUSES.map(s => (
              <option key={s} value={s}>{s || 'All'}</option>
            ))}
          </select>

          <label className="block text-xs text-slate-400 mb-1">Scenario</label>
          <select
            value={scenario}
            onChange={e => setScenario(e.target.value)}
            className="input mb-3"
          >
            {SCENARIOS.map(s => (
              <option key={s} value={s}>{s || 'All'}</option>
            ))}
          </select>

          <button onClick={load} className="btn btn-secondary w-full text-xs">
            ↺ Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="border-t border-[#252d3d] pt-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Stats</p>
          <div className="space-y-1.5 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>Total</span>
              <span className="text-slate-200 font-semibold">{total}</span>
            </div>
            <div className="flex justify-between">
              <span>Pending</span>
              <span className="text-amber-300 font-semibold">{pending}</span>
            </div>
            <div className="flex justify-between">
              <span>Approved</span>
              <span className="text-emerald-300 font-semibold">{approved}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <span className="spinner w-4 h-4 text-sky-400" />
            Loading captures…
          </div>
        )}

        {error && (
          <div className="card border-red-800/50 bg-red-950/20 text-red-300 text-sm mb-4">
            ⚠ {error}
            <button onClick={load} className="ml-3 underline text-red-400 hover:text-red-200">Retry</button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 text-slate-500 mt-20 text-sm">
            <svg viewBox="0 0 24 24" className="w-10 h-10 opacity-30" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 9h6M9 13h4" />
            </svg>
            <p>No captures found.</p>
            {(status || scenario) && (
              <button onClick={() => { setStatus(''); setScenario(''); }}
                className="text-sky-400 hover:text-sky-300 underline text-xs">
                Clear filters
              </button>
            )}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map(item => (
              <CaptureCard key={item.pk} capture={item} onClick={() => onSelect(item)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
