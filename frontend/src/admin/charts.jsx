import { useState } from 'react';

// Dependency-free SVG charts for the admin console. Responsive (viewBox,
// width 100%), with a tooltip on hover / tap / keyboard focus.

const GRID = 'rgba(255,255,255,.08)';
const AXIS = '#8a90a8';

function Tooltip({ x, y, W, lines }) {
  const w = Math.max(...lines.map((l) => l.length)) * 6.4 + 16;
  const h = lines.length * 15 + 10;
  const tx = Math.min(Math.max(4, x - w / 2), W - w - 4);
  const ty = Math.max(4, y - h - 10);
  return (
    <g pointerEvents="none">
      <rect x={tx} y={ty} width={w} height={h} rx="7" fill="rgba(18,19,34,.96)" stroke="rgba(255,255,255,.18)" />
      {lines.map((l, i) => (
        <text key={i} x={tx + 8} y={ty + 18 + i * 15} fill={i ? '#e8eaf6' : AXIS} fontSize="11">{l}</text>
      ))}
    </g>
  );
}

const niceMax = (v) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

/**
 * Grouped / single bar chart.
 * data: [{ label, ...values }], series: [[key, colour, name]]
 */
export function BarChart({ data, series, height = 220, label, xLabel = (d) => d.label, every = 1 }) {
  const [hi, setHi] = useState(null);
  const W = 720, H = height, PL = 34, PR = 10, PT = 14, PB = 26;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map(([k]) => d[k] || 0))));
  const n = data.length || 1;
  const slot = (W - PL - PR) / n;
  const bw = Math.max(2, (slot * 0.74) / series.length);
  const y = (v) => H - PB - (v / max) * (H - PT - PB);
  const d = hi != null ? data[hi] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ad-chart" role="img" aria-label={label}
      onMouseLeave={() => setHi(null)}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(max * t)} y2={y(max * t)} stroke={GRID} />
          <text x={PL - 6} y={y(max * t) + 4} fill={AXIS} fontSize="10" textAnchor="end">{Math.round(max * t)}</text>
        </g>
      ))}
      {data.map((row, i) => (
        <g key={i} tabIndex={0} onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onClick={() => setHi(i)}>
          <rect x={PL + i * slot} y={PT} width={slot} height={H - PT - PB} fill={hi === i ? 'rgba(255,255,255,.05)' : 'transparent'} />
          {series.map(([k, c], j) => {
            const v = row[k] || 0;
            const x = PL + i * slot + (slot - bw * series.length) / 2 + j * bw;
            return <rect key={k} x={x} y={y(v)} width={bw - 1} height={Math.max(0, H - PB - y(v))} rx="2" fill={c} opacity={hi == null || hi === i ? 1 : 0.55} />;
          })}
          {(i % every === 0 || i === n - 1) && (
            <text x={PL + i * slot + slot / 2} y={H - 8} fill={AXIS} fontSize="10" textAnchor="middle">{xLabel(row, i)}</text>
          )}
        </g>
      ))}
      {d && (
        <Tooltip x={PL + hi * slot + slot / 2} y={y(Math.max(...series.map(([k]) => d[k] || 0)))} W={W}
          lines={[d.tip || xLabel(d, hi), ...series.map(([k, , name]) => `${name || k}: ${d[k] || 0}`)]} />
      )}
    </svg>
  );
}

/** Multi-series line chart over a time axis. data: [{ date, ...values }] */
export function LineChart({ data, series, height = 230, label }) {
  const [hi, setHi] = useState(null);
  const W = 720, H = height, PL = 34, PR = 12, PT = 14, PB = 26;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map(([k]) => d[k] || 0))));
  const n = data.length;
  const x = (i) => PL + (i * (W - PL - PR)) / Math.max(1, n - 1);
  const y = (v) => H - PB - (v / max) * (H - PT - PB);
  const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHi(Math.max(0, Math.min(n - 1, Math.round(((px - PL) / (W - PL - PR)) * (n - 1)))));
  };
  const d = hi != null ? data[hi] : null;
  const ticks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ad-chart" role="img" aria-label={label}
      onMouseMove={pick} onClick={pick} onMouseLeave={() => setHi(null)}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(max * t)} y2={y(max * t)} stroke={GRID} />
          <text x={PL - 6} y={y(max * t) + 4} fill={AXIS} fontSize="10" textAnchor="end">{Math.round(max * t)}</text>
        </g>
      ))}
      {series.map(([k, c]) => (
        <g key={k}>
          <polygon fill={c} opacity=".08"
            points={`${x(0)},${y(0)} ${data.map((p, i) => `${x(i)},${y(p[k] || 0)}`).join(' ')} ${x(n - 1)},${y(0)}`} />
          <polyline fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round"
            points={data.map((p, i) => `${x(i)},${y(p[k] || 0)}`).join(' ')} />
        </g>
      ))}
      {ticks.map((i) => data[i] && (
        <text key={i} x={x(i)} y={H - 8} fill={AXIS} fontSize="10"
          textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{fmt(data[i].date)}</text>
      ))}
      {d && (
        <g pointerEvents="none">
          <line x1={x(hi)} x2={x(hi)} y1={PT} y2={H - PB} stroke="rgba(255,255,255,.25)" strokeDasharray="3 3" />
          {series.map(([k, c]) => <circle key={k} cx={x(hi)} cy={y(d[k] || 0)} r="3.5" fill={c} />)}
          <Tooltip x={x(hi)} y={PT + 60} W={W}
            lines={[fmt(d.date), ...series.map(([k, , name]) => `${name || k}: ${d[k] || 0}`)]} />
        </g>
      )}
    </svg>
  );
}

export function Legend({ series }) {
  return (
    <div className="ad-legend">
      {series.map(([k, c, name]) => <span key={k}><b style={{ background: c }} />{name || k}</span>)}
    </div>
  );
}
