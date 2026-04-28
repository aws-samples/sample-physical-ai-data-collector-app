import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Chart, LineController, LineElement, PointElement, LinearScale,
  CategoryScale, Filler, Legend, Tooltip,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { getVideoUrl, getSensorData, getLabels, updateLabels } from '../api';
import type { CaptureItem, SensorResponse, Labels } from '../api';
import { getUser } from '../auth';

Chart.register(
  LineController, LineElement, PointElement,
  LinearScale, CategoryScale, Filler, Legend, Tooltip,
  annotationPlugin,
);

// ── constants ─────────────────────────────────────────────────────────────────
const QUALITY_OPTIONS = ['', 'excellent', 'good', 'fair', 'poor', 'unusable'];
const STATUS_OPTIONS  = ['pending', 'in-review', 'approved', 'rejected'];
const PRESET_TAGS     = ['smooth', 'steady', 'shaky', 'interrupted', 'clean', 'noisy', 'indoor', 'outdoor'];
const PRESET_ISSUES   = ['video-corruption', 'sensor-dropout', 'sync-issue', 'motion-blur', 'low-light'];

// Column index layout (matches lambda get-sensor-data/index.py):
//  0           : timestampMs
//  1-3         : accel_x/y/z
//  4-6         : gyro_x/y/z
//  7-9         : mag_x/y/z
//  10-12       : gravity_x/y/z
//  13-15       : linear_accel_x/y/z
//  16-19       : rot_x/y/z/w
//  20          : rot_heading_accuracy
//  21          : pressure
//  22          : light
//  23          : proximity
//  24-26       : lat/lng/alt
//  27          : speed
//  28          : bearing
//  29          : gps_accuracy

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtMs(ms: number, withTenths = false) {
  const s   = ms / 1000;
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${m}:${String(sec).padStart(2, '0')}`;
  if (!withTenths) return base;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${base}.${tenths}`;
}

interface SeriesSpec {
  label: string;
  col: number;
  color: string;
}

function buildChartDataFromSeries(sensor: SensorResponse, series: SeriesSpec[]) {
  const step = Math.max(1, Math.floor(sensor.data.length / 2000));
  const data = sensor.data.filter((_, i) => i % step === 0);
  const t0   = sensor.data[0][0];
  return {
    labels: data.map(d => d[0] - t0),
    datasets: series.map(s => ({
      label:       s.label,
      data:        data.map(d => d[s.col]),
      borderColor: s.color,
      borderWidth: 1.2,
      pointRadius: 0,
      tension:     0.2,
    })),
  };
}

function makeChartOptions(videoRef: React.RefObject<HTMLVideoElement | null>) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { labels: { color: '#94a3b8', boxWidth: 10, font: { size: 11 } } },
      tooltip: {
        backgroundColor: '#161b27', borderColor: '#252d3d', borderWidth: 1,
        titleColor: '#e2e8f0', bodyColor: '#94a3b8',
        callbacks: {
          title: (items: { label: string }[]) => fmtMs(Number(items[0]?.label ?? 0)),
        },
      },
      annotation: { annotations: {} },
    },
    scales: {
      x: {
        type: 'linear' as const,
        ticks: {
          color: '#475569',
          maxTicksLimit: 8,
          callback: (v: number | string) => fmtMs(Number(v)),
        },
        grid: { color: '#1a2030' },
      },
      y: {
        ticks: { color: '#475569' },
        grid: { color: '#1a2030' },
      },
    },
    onClick: (_e: unknown, _elements: unknown, chart: Chart) => {
      // handled via canvas click listener for precise mapping
      void chart;
    },
  };
}

// ── chart groups config ───────────────────────────────────────────────────────
interface ChartGroup {
  title: string;
  unit: string;
  series: SeriesSpec[];
}

const CHART_GROUPS: ChartGroup[] = [
  {
    title: 'Accelerometer', unit: 'm/s²',
    series: [
      { label: 'X', col: 1,  color: '#f87171' },
      { label: 'Y', col: 2,  color: '#34d399' },
      { label: 'Z', col: 3,  color: '#38bdf8' },
    ],
  },
  {
    title: 'Gyroscope', unit: 'rad/s',
    series: [
      { label: 'X', col: 4,  color: '#f87171' },
      { label: 'Y', col: 5,  color: '#34d399' },
      { label: 'Z', col: 6,  color: '#38bdf8' },
    ],
  },
  {
    title: 'Magnetometer', unit: 'µT',
    series: [
      { label: 'X', col: 7,  color: '#c084fc' },
      { label: 'Y', col: 8,  color: '#f472b6' },
      { label: 'Z', col: 9,  color: '#fb923c' },
    ],
  },
  {
    title: 'Gravity', unit: 'm/s²',
    series: [
      { label: 'X', col: 10, color: '#f87171' },
      { label: 'Y', col: 11, color: '#34d399' },
      { label: 'Z', col: 12, color: '#38bdf8' },
    ],
  },
  {
    title: 'Linear Acceleration', unit: 'm/s²',
    series: [
      { label: 'X', col: 13, color: '#fde68a' },
      { label: 'Y', col: 14, color: '#6ee7b7' },
      { label: 'Z', col: 15, color: '#93c5fd' },
    ],
  },
  {
    title: 'Rotation Vector', unit: 'quaternion',
    series: [
      { label: 'X', col: 16, color: '#f87171' },
      { label: 'Y', col: 17, color: '#34d399' },
      { label: 'Z', col: 18, color: '#38bdf8' },
      { label: 'W', col: 19, color: '#a78bfa' },
    ],
  },
  {
    title: 'Environmental', unit: 'hPa / lux / cm',
    series: [
      { label: 'Pressure (hPa)', col: 21, color: '#fb923c' },
      { label: 'Light (lux)',    col: 22, color: '#fde68a' },
      { label: 'Proximity (cm)', col: 23, color: '#6ee7b7' },
    ],
  },
  {
    title: 'GPS', unit: 'm / m/s',
    series: [
      { label: 'Altitude (m)',    col: 26, color: '#34d399' },
      { label: 'Speed (m/s)',     col: 27, color: '#38bdf8' },
      { label: 'Accuracy (m)',    col: 29, color: '#f87171' },
    ],
  },
];

// ── component ─────────────────────────────────────────────────────────────────
interface Props {
  capture: CaptureItem;
  onBack: () => void;
}

export default function CaptureDetail({ capture, onBack }: Props) {
  // video
  const videoRef  = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoErr, setVideoErr] = useState('');
  const [speed, setSpeed]       = useState(1);

  // sensor
  const [sensor, setSensor]       = useState<SensorResponse | null>(null);
  const [sensorErr, setSensorErr] = useState('');

  // One canvas ref + chart ref per group
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(CHART_GROUPS.map(() => null));
  const chartRefs  = useRef<(Chart | null)[]>(CHART_GROUPS.map(() => null));
  const rafRef     = useRef<number>(0);

  // labels
  const [labels, setLabels]           = useState<Labels | null>(null);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState('');
  const [quality, setQuality]         = useState('');
  const [tags, setTags]               = useState<string[]>([]);
  const [issues, setIssues]           = useState<string[]>([]);
  const [notes, setNotes]             = useState('');
  const [labelStatus, setLabelStatus] = useState('pending');
  const [tagInput, setTagInput]       = useState('');

  // ── load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setVideoUrl(''); setVideoErr('');
    getVideoUrl(capture.pk)
      .then(r => setVideoUrl(r.url))
      .catch(e => setVideoErr(e instanceof Error ? e.message : 'Failed to load video'));
  }, [capture.pk]);

  useEffect(() => {
    setSensorErr('');
    getSensorData(capture.pk)
      .then(setSensor)
      .catch(e => setSensorErr(e instanceof Error ? e.message : 'Failed to load sensor data'));
  }, [capture.pk]);

  useEffect(() => {
    getLabels(capture.pk).then(l => {
      setLabels(l);
      setQuality(l.quality ?? '');
      setTags(l.tags ?? []);
      setIssues(l.issues ?? []);
      setNotes(l.notes ?? '');
      setLabelStatus(l.status ?? 'pending');
    }).catch(() => {/* no labels yet */});
  }, [capture.pk]);

  // ── build all charts ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sensor) return;

    const opts = makeChartOptions(videoRef);

    // click-to-seek helper
    const handleClick = (chart: Chart, e: MouseEvent) => {
      const rect    = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const xPct    = (e.clientX - rect.left) / rect.width;
      const xScale  = chart.scales['x'];
      const clickMs = xScale.min + xPct * (xScale.max - xScale.min);
      if (videoRef.current) videoRef.current.currentTime = clickMs / 1000;
    };

    const listeners: Array<{ el: HTMLCanvasElement; fn: (e: MouseEvent) => void }> = [];

    CHART_GROUPS.forEach((group, idx) => {
      const canvas = canvasRefs.current[idx];
      if (!canvas) return;

      // destroy existing
      chartRefs.current[idx]?.destroy();

      // Deep-clone options so each chart gets its own annotation object
      const chartOpts = JSON.parse(JSON.stringify(opts));
      chartOpts.plugins.annotation = {
        annotations: {
          playhead: {
            type: 'line',
            scaleID: 'x',
            value: 0,
            borderColor: '#fbbf24',
            borderWidth: 2,
            drawTime: 'afterDatasetsDraw',
            label: {
              display: true,
              content: '0:00',
              position: 'start',
              backgroundColor: '#fbbf24',
              color: '#0f172a',
              font: { size: 10, weight: 'bold' },
              padding: { x: 4, y: 2 },
              yAdjust: -6,
            },
          },
        },
      };

      const chart = new Chart(canvas, {
        type: 'line',
        data: buildChartDataFromSeries(sensor, group.series),
        options: chartOpts,
      });
      chartRefs.current[idx] = chart;

      const fn = (e: MouseEvent) => handleClick(chart, e);
      canvas.addEventListener('click', fn);
      listeners.push({ el: canvas, fn });
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      listeners.forEach(({ el, fn }) => el.removeEventListener('click', fn));
      chartRefs.current.forEach(c => c?.destroy());
      chartRefs.current = CHART_GROUPS.map(() => null);
    };
  }, [sensor]);

  // ── RAF playhead sync loop ─────────────────────────────────────────────────
  // Runs on every animation frame while video is playing; also fires on seek.
  // Updates the 'playhead' annotation value on every chart instance.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updatePlayhead = () => {
      const msNow  = video.currentTime * 1000;
      const label  = fmtMs(msNow, true); // m:ss.t granularity on the playhead badge
      chartRefs.current.forEach(chart => {
        if (!chart) return;
        const ann = (chart.options.plugins as any)?.annotation?.annotations?.playhead;
        if (ann) {
          ann.value         = msNow;
          ann.label.content = label;
          chart.update('none'); // 'none' = skip animation, max perf
        }
      });
    };

    const loop = () => {
      updatePlayhead();
      rafRef.current = requestAnimationFrame(loop);
    };

    const start = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(loop); };
    const stop  = () => { cancelAnimationFrame(rafRef.current); };
    const seek  = () => { updatePlayhead(); }; // instant update on scrub

    video.addEventListener('play',   start);
    video.addEventListener('pause',  stop);
    video.addEventListener('ended',  stop);
    video.addEventListener('seeked', seek);

    return () => {
      stop();
      video.removeEventListener('play',   start);
      video.removeEventListener('pause',  stop);
      video.removeEventListener('ended',  stop);
      video.removeEventListener('seeked', seek);
    };
  }, [videoUrl]); // re-run once the <video> element is mounted (videoUrl drives conditional render)

  // ── playback speed ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // ── save labels ────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setSaving(true); setSaveMsg('');
    try {
      const user = getUser();
      await updateLabels(capture.pk, {
        quality, tags, issues, notes, status: labelStatus,
        reviewer: user?.email ?? user?.username ?? '',
      });
      setSaveMsg('Saved ✓');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      setSaveMsg(e instanceof Error ? `Error: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [capture.pk, quality, tags, issues, notes, labelStatus]);

  // ── tag helpers ────────────────────────────────────────────────────────────
  const addTag = (t: string) => {
    const clean = t.trim().toLowerCase();
    if (clean && !tags.includes(clean)) setTags(prev => [...prev, clean]);
  };
  const removeTag   = (t: string) => setTags(prev => prev.filter(x => x !== t));
  const toggleIssue = (i: string) =>
    setIssues(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    // Two-pane layout: left pane fixed, right pane scrolls independently
    // Use viewport height minus header (56px = 3.5rem)
    <div className="flex" style={{ height: 'calc(100vh - 3.5rem)' }}>

      {/* ── Left pane: video (fixed, always visible) ── */}
      <div className="w-[480px] shrink-0 p-6 pr-3 overflow-hidden">
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Video</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Speed</label>
              <select
                value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
                className="input w-20 text-xs py-1"
              >
                {[0.25, 0.5, 1, 1.5, 2].map(s => (
                  <option key={s} value={s}>{s}×</option>
                ))}
              </select>
            </div>
          </div>

          {!videoUrl && !videoErr && (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
              <span className="spinner w-4 h-4 text-sky-400" />
              Loading video…
            </div>
          )}
          {videoErr && (
            <div className="text-red-400 text-sm py-4 text-center">⚠ {videoErr}</div>
          )}
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full rounded-lg bg-black max-h-[480px]"
            />
          )}
        </div>
      </div>

      {/* ── Right pane: labels + sensor charts (scrolls independently) ── */}
      <div className="flex-1 min-w-0 p-6 pl-3 overflow-y-auto">
        <div className="space-y-6">

        {/* Label editor */}
        <div className="card space-y-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Labels</p>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Quality</label>
            <select value={quality} onChange={e => setQuality(e.target.value)} className="input">
              {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q || '— select —'}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select value={labelStatus} onChange={e => setLabelStatus(e.target.value)} className="input">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {PRESET_TAGS.map(t => (
                <button
                  key={t}
                  onClick={() => tags.includes(t) ? removeTag(t) : addTag(t)}
                  className={`badge cursor-pointer transition-all ${tags.includes(t) ? 'badge-info ring-sky-500' : 'badge-muted hover:badge-info'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tags.filter(t => !PRESET_TAGS.includes(t)).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.filter(t => !PRESET_TAGS.includes(t)).map(t => (
                  <button key={t} onClick={() => removeTag(t)} className="badge badge-info">
                    {t} ×
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { addTag(tagInput); setTagInput(''); } }}
                placeholder="Custom tag…"
                className="input flex-1 text-xs"
              />
              <button onClick={() => { addTag(tagInput); setTagInput(''); }}
                className="btn btn-secondary text-xs px-2">Add</button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Issues</label>
            <div className="grid grid-cols-2 gap-1">
              {PRESET_ISSUES.map(i => (
                <label key={i} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={issues.includes(i)}
                    onChange={() => toggleIssue(i)}
                    className="accent-sky-500"
                  />
                  {i}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="Optional reviewer notes…"
            />
          </div>

          {labels?.reviewer && (
            <p className="text-xs text-slate-500">
              Last reviewed by <span className="text-slate-400">{labels.reviewer}</span>
              {labels.reviewedAt ? ` on ${new Date(labels.reviewedAt).toLocaleString()}` : ''}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="btn btn-primary">
              {saving ? <><span className="spinner w-3.5 h-3.5" /> Saving…</> : 'Save Labels'}
            </button>
            {saveMsg && (
              <span className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                {saveMsg}
              </span>
            )}
          </div>
        </div>

        {/* Sensor charts */}
        <div className="space-y-4">
          {sensorErr && (
            <div className="card border-red-800/50 bg-red-950/20 text-red-300 text-sm">⚠ {sensorErr}</div>
          )}
          {!sensor && !sensorErr && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <span className="spinner w-4 h-4 text-sky-400" />
              Loading sensor data…
            </div>
          )}
          {sensor && CHART_GROUPS.map((group, idx) => (
            <div className="card" key={group.title}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {group.title}
                <span className="ml-1 text-slate-600 font-normal normal-case">({group.unit})</span>
                <span className="ml-2 text-slate-700 font-normal normal-case">· click to seek</span>
              </p>
              <div style={{ height: '160px' }}>
                <canvas
                  ref={el => { canvasRefs.current[idx] = el; }}
                />
              </div>
            </div>
          ))}
        </div>

        </div>
      </div>
    </div>
  );
}
