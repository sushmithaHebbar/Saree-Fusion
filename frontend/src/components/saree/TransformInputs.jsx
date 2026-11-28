import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';

// Numeric transform controls: typed values commit on Enter or blur (never on
// every keystroke, never from a slider or the mouse wheel), and are clamped or
// normalised before they reach the simulation state.

const SCALE_MIN_PCT = 10;
const SCALE_MAX_PCT = 500;
const SCALE_PRESETS = [50, 75, 100, 150, 200];
const ROT_PRESETS = [0, 45, 90, 180, 270];

// Any real number → [0, 360) clockwise
function normalizeDeg(v) {
  return ((Math.round(v) % 360) + 360) % 360;
}

function clampScalePct(v) {
  return Math.min(SCALE_MAX_PCT, Math.max(SCALE_MIN_PCT, Math.round(v)));
}

const field =
  'h-10 w-full rounded-xl border border-line bg-surface-2/70 pl-3 pr-10 text-base tabular-nums text-fg focus:border-gold focus:outline-none';
const chip = (on) =>
  `sf-tap min-h-9 rounded-lg px-2 text-xs font-semibold tabular-nums ${
    on ? 'bg-gold text-[#1d1700]' : 'border border-line bg-surface text-muted hover:text-fg'
  }`;

// Text field holding a draft until committed; Escape reverts the draft
function CommitInput({ id, value, unit, onCommit, ariaLabel }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(String(value));
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onWheel={(e) => e.currentTarget.blur()} /* no scroll-wheel adjustments */
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setDraft(String(value));
        }}
        className={field}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
        {unit}
      </span>
    </div>
  );
}

// slot.scale is a factor (1 = 100%); the UI speaks in percent
export function ScaleInput({ id, label, scale, onChange }) {
  const pct = Math.round((scale || 1) * 100);
  const set = (v) => onChange(clampScalePct(v) / 100);
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 flex justify-between text-xs text-muted">
        <span>Scale</span>
        <span className="text-muted/70">{SCALE_MIN_PCT}–{SCALE_MAX_PCT}%</span>
      </label>
      <CommitInput id={id} value={pct} unit="%" onCommit={set} ariaLabel={`${label} scale in percent`} />
      <div className="mt-1.5 grid grid-cols-5 gap-1" role="group" aria-label={`${label} scale presets`}>
        {SCALE_PRESETS.map((v) => (
          <button key={v} type="button" aria-pressed={pct === v} onClick={() => set(v)} className={chip(pct === v)}>
            {v}%
          </button>
        ))}
      </div>
    </div>
  );
}

export function RotationInput({ id, label, rot, onChange }) {
  const deg = normalizeDeg(rot || 0);
  const set = (v) => onChange(normalizeDeg(v));
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          Rotation <RotateCw size={12} aria-hidden /> clockwise
        </span>
        <span className="text-muted/70">0–359°</span>
      </label>
      <div className="flex gap-1.5">
        <div className="flex-1">
          <CommitInput id={id} value={deg} unit="°" onCommit={set} ariaLabel={`${label} rotation in degrees clockwise`} />
        </div>
        {/* Live preview of the angle: the arrow turns clockwise like the motif */}
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-2/70">
          <span className="block text-gold transition-transform" style={{ transform: `rotate(${deg}deg)` }}>↑</span>
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1" role="group" aria-label={`${label} clockwise rotation presets`}>
        {ROT_PRESETS.map((v) => (
          <button key={v} type="button" aria-pressed={deg === v} onClick={() => set(v)} className={chip(deg === v)}>
            {v}°
          </button>
        ))}
      </div>
    </div>
  );
}
