import type { CaptureItem } from '../api';

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

interface Props {
  capture: CaptureItem;
  onClick: () => void;
}

export default function CaptureCard({ capture, onClick }: Props) {
  const date = new Date(capture.capturedAt);
  const status  = capture.labelStatus  || 'pending';
  const quality = capture.labelQuality || '';

  return (
    <button
      onClick={onClick}
      className="card w-full text-left hover:border-sky-700/50 hover:bg-sky-950/10 transition-all duration-150 group"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-100 capitalize truncate group-hover:text-sky-300 transition-colors">
            {capture.scenario || 'Unknown Scenario'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {date.toLocaleString(undefined, {
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={STATUS_BADGE[status] ?? 'badge badge-muted'}>{status}</span>
          {quality && (
            <span className={QUALITY_BADGE[quality] ?? 'badge badge-muted'}>{quality}</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 mb-3">
        <span>📍 {capture.location || '—'}</span>
        <span>🤖 {capture.deviceId || '—'}</span>
        <span>📋 {capture.taskType || '—'}</span>
      </div>

      {/* Tags */}
      {capture.labelTags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {capture.labelTags.map(t => (
            <span key={t} className="badge badge-muted text-[11px]">{t}</span>
          ))}
        </div>
      )}
    </button>
  );
}
