import { useEffect, useState, useCallback } from 'react';
import { listCaptures } from '../api';
import type { CaptureItem } from '../api';
import CaptureCard from '../components/CaptureCard';

const STATUSES  = ['', 'pending', 'in-review', 'approved', 'rejected'];
const SCENARIOS = ['', 'logistics', 'assembly', 'welding', 'autonomous', 'inspection', 'other'];

const STATUS_BADGE: Record<string, string> = {
  pending:    'badge badge-warn',
  'in-review':'badge badge-info',
  approved:   'badge badge-ok',
  rejected:   'badge badge-error',
};

const QUALITY_BADGE: Record<string, string> = {
  excellent: 'badge badge-ok',
  good:      'badge badge-ok',
  fair:      'badge badge-warn',
  poor:      'badge badge-error',
  unusable:  'badge badge-error',
};

type ViewMode = 'table' | 'tiles';
type SortDir  = 'asc' | 'desc';

interface Props {
  onSelect: (c: CaptureItem) => void;
}

export default function CaptureList({ onSelect }: Props) {
  const [items, setItems]       = useState<CaptureItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [status, setStatus]     = useState('');
  const [scenario, setScenario] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');

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

  // Sort
  const sortedItems = [...items].sort((a, b) =>
    sortDir === 'desc' ? b.capturedAt - a.capturedAt : a.capturedAt - b.capturedAt
  );

  const toggleSort = () => setSortDir(d => d === 'desc' ? 'asc' : 'desc');

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
      <div className="flex-1 overflow-auto flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <p className="text-xs text-slate-500">
            {!loading && `${sortedItems.length} capture${sortedItems.length !== 1 ? 's' : ''}`}
          </p>
          {/* View mode toggle */}
          <div className="flex items-center gap-1 bg-[#161b27] border border-[#252d3d] rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('table')}
              title="Table view"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {/* List/table icon */}
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="2" width="14" height="3" rx="0.5"/>
                <rect x="1" y="7" width="14" height="3" rx="0.5"/>
                <rect x="1" y="12" width="14" height="3" rx="0.5"/>
              </svg>
            </button>
            <button
              onClick={() => setViewMode('tiles')}
              title="Tiles view"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'tiles' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {/* Grid icon */}
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="6" height="6" rx="0.5"/>
                <rect x="9" y="1" width="6" height="6" rx="0.5"/>
                <rect x="1" y="9" width="6" height="6" rx="0.5"/>
                <rect x="9" y="9" width="6" height="6" rx="0.5"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6">
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 text-sm mt-4">
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

          {/* ── Table view ── */}
          {!loading && sortedItems.length > 0 && viewMode === 'table' && (
            <div className="overflow-x-auto rounded-xl border border-[#252d3d]">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#0d1117] text-xs text-slate-500 uppercase tracking-wider">
                    <th
                      className="px-4 py-2.5 text-left font-semibold cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap"
                      onClick={toggleSort}
                    >
                      Captured&nbsp;
                      <span className="text-sky-400">{sortDir === 'desc' ? '▼' : '▲'}</span>
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold">Scenario</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Location</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Device</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Task</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item, idx) => {
                    const date    = new Date(item.capturedAt);
                    const status  = item.labelStatus  || 'pending';
                    const quality = item.labelQuality || '';
                    return (
                      <tr
                        key={item.pk}
                        onClick={() => onSelect(item)}
                        className={`cursor-pointer border-t border-[#252d3d] transition-colors duration-100
                          ${idx % 2 === 0 ? 'bg-[#161b27]' : 'bg-[#131720]'}
                          hover:bg-sky-950/20 hover:border-sky-800/30 group`}
                      >
                        <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap font-mono text-xs">
                          {date.toLocaleString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-2.5 text-slate-200 capitalize font-medium group-hover:text-sky-300 transition-colors">
                          {item.scenario || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{item.location || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{item.deviceId || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{item.taskType || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={STATUS_BADGE[status] ?? 'badge badge-muted'}>{status}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {quality && (
                            <span className={QUALITY_BADGE[quality] ?? 'badge badge-muted'}>{quality}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tiles view ── */}
          {!loading && sortedItems.length > 0 && viewMode === 'tiles' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {sortedItems.map(item => (
                <CaptureCard key={item.pk} capture={item} onClick={() => onSelect(item)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
