import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud, X, Download, Printer, RefreshCw, ArrowLeft, LogOut, ArrowRight,
  Palette, Layers, Ruler, Image as ImageIcon, Flower2, Frame, Maximize2, MoveVertical,
  GalleryHorizontal, Repeat, Grid3x3, PanelLeftOpen,
} from 'lucide-react';
import StudioSidebar from '../components/saree/StudioSidebar';
import { ScaleInput, RotationInput } from '../components/saree/TransformInputs';
import { useSareeDesign } from '../context/SareeDesignContext.jsx';
import ColorPickerOverlay from '../components/saree/ColorPickerOverlay';
import CadViewer from '../components/saree/CadViewer';
import SimulationCanvas from '../components/saree/SimulationCanvas';
import CollectionAutoSaver from '../components/saree/CollectionAutoSaver';
import GeneratingOverlay from '../components/saree/GeneratingOverlay';
import { generateBatch } from '../utils/generateBatch';
import { haptic } from '../utils/haptics';
import { DEFAULT_PARAMS, computeSpecs } from '../utils/sareeLayout';
import { dominantGround } from '../utils/motifGround';
import { useUsage, usageMessage } from '../utils/usage';

const VIEWS = [
  { key: 'layout', label: 'Flat template' },
  { key: 'cad',    label: 'CAD sketch' },
];

const DRAPE_STYLES = [
  { key: 'normal', label: 'Nivi' },
  { key: 'mysore', label: 'Mysore' },
  { key: 'kadagu', label: 'Kodava (Kadagu)' },
];

// Load an image URL (object URL from the Design page, or a static path)
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    if (!url.startsWith('blob:')) el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = url;
  });
}

// Defaults, specs and layout geometry live in one shared module, read by the
// flat template, the CAD sketch and the telemetry cards alike.
const DEF = DEFAULT_PARAMS;

// ─── BMP encoder (24-bit, top-down) ──────────────────────────────────────────
function encodeImageDataAsBMP(imageData) {
  const { width, height, data } = imageData;
  const paddedRow = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = paddedRow * height;
  const fileSize = 54 + pixelArraySize;
  const buf = new Uint8Array(fileSize);
  const dv = new DataView(buf.buffer);
  // File header
  buf[0] = 0x42; buf[1] = 0x4D;
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, 54, true);
  // DIB header
  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // positive = bottom-up rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, pixelArraySize, true);
  dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  // Pixel data (bottom-up BGR)
  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y;
    const rowStart = 54 + bmpRow * paddedRow;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = rowStart + x * 3;
      buf[d] = data[s + 2]; buf[d + 1] = data[s + 1]; buf[d + 2] = data[s];
    }
  }
  return buf;
}

// ─── Extract top yarn colors from canvas ─────────────────────────────────────
function extractYarnColors(ctx, w, h) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;
  const counts = {};
  const step = 8;
  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    counts[key] = (counts[key] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, cnt]) => {
      const r = ((key >> 10) & 0x1F) << 3;
      const g = ((key >> 5)  & 0x1F) << 3;
      const b = (key         & 0x1F) << 3;
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      return { hex, pct: ((cnt / total) * 100).toFixed(1) };
    });
}

// ─── Small UI atoms (Tailwind, theme-aware) ──────────────────────────────────
const panel = 'rounded-2xl border border-line bg-glass backdrop-blur-md';
const tap = 'sf-tap inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold';

// ─── Number input ─────────────────────────────────────────────────────────────
// Keeps the typed text as a draft, so "", "4." or "-" never get forced into a
// number mid-edit. Every valid value within range is applied immediately (the
// layout redraws live); blur snaps the field back to the clamped value.
function NumInput({ label, unit, value, onChange, min = 0, max = Infinity, step = 1 }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <label className="mb-2.5 block">
      <span className="text-xs text-muted">{label}</span>
      <span className="relative mt-1 block">
        <input
          type="text" inputMode="decimal" value={draft}
          onFocus={() => setEditing(true)}
          onChange={e => {
            const text = e.target.value;
            if (!/^-?\d*\.?\d*$/.test(text)) return;       // digits, one dot only
            setDraft(text);
            const n = parseFloat(text);
            if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={() => {
            setEditing(false);
            const n = parseFloat(draft);
            const next = Number.isFinite(n) ? clamp(n) : value;
            if (next !== value) onChange(next);
            setDraft(String(next));
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const n = clamp(+(value + (e.key === 'ArrowUp' ? step : -step)).toFixed(4));
              onChange(n);
              setDraft(String(n));
            }
          }}
          className="h-11 w-full rounded-xl border border-line bg-surface-2/70 pl-3 pr-20 text-base tabular-nums text-fg focus:border-gold focus:outline-none"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted/80">{unit}</span>
      </span>
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="mb-2.5 flex items-start justify-between gap-3">
      <span>
        <span className="block text-xs text-fg">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={() => onChange(!checked)}
        className={`sf-tap relative h-7 w-12 shrink-0 rounded-full border transition-colors ${checked ? 'border-gold bg-gold' : 'border-line bg-surface-2'}`}>
        <span className={`absolute top-0.5 h-5.5 w-5.5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[calc(100%-1.5rem)]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

// ─── Stats card ───────────────────────────────────────────────────────────────
function StatCard({ title, rows }) {
  return (
    <div className={`${panel} p-4`}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gold">{title}</div>
      {rows.map(([label, val]) => (
        <div key={label} className="flex justify-between border-b border-line py-1.5 last:border-0">
          <span className="text-sm text-muted">{label}</span>
          <span className={`text-sm text-fg ${label === 'Total' ? 'font-bold' : ''}`}>{val}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Image uploader with numeric scale + clockwise rotation ──────────────────
function MotifUploader({ id, label, slot, onChange }) {
  const inputRef = useRef(null);
  return (
    <div>
      {slot.url ? (
        <div className="relative mb-2">
          <img src={slot.url} alt={label} className="h-20 w-full rounded-xl object-cover" />
          <button type="button" aria-label={`Remove ${label}`} onClick={() => onChange({ ...slot, url: null, el: null })}
            className="sf-tap absolute right-1 top-1 grid h-11 w-11 place-items-center text-white">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-black/65"><X size={14} /></span>
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current.click()}
          className="sf-tap mb-2 flex h-16 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-sm text-muted">
          <UploadCloud size={18} /> Upload {label}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={e => {
          const file = e.target.files[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          const el = new Image();
          el.onload = () => onChange({ ...slot, url, el });
          el.src = url;
        }}
      />
      <ScaleInput id={`${id}-scale`} label={label} scale={slot.scale}
        onChange={scale => onChange({ ...slot, scale })} />
      <RotationInput id={`${id}-rot`} label={label} rot={slot.rot}
        onChange={rot => onChange({ ...slot, rot })} />
    </div>
  );
}

// Pinch-to-zoom for the flat template; native touch scrolling handles panning
function usePinchZoom(ref, zoom, setZoom) {
  const start = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const down = (e) => { if (e.touches.length === 2) start.current = { d: dist(e.touches), z: zoom }; };
    const move = (e) => {
      if (e.touches.length === 2 && start.current) {
        e.preventDefault();
        setZoom(Math.min(2, Math.max(0.1, start.current.z * (dist(e.touches) / start.current.d))));
      }
    };
    const up = () => { start.current = null; };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
    };
  }, [ref, zoom, setZoom]);
}

// ─── Simulation page ──────────────────────────────────────────────────────────
export default function Simulation() {
  const { assets } = useSareeDesign();
  // Set when a saved layout is re-opened from the collection: restores its loom
  // parameters and colourway, and keeps saving into the same collection entry.
  const restore = assets.restore || null;
  const [p, setP] = useState({ ...DEF, ...(restore?.params || {}) });
  const [imgs, setImgs] = useState({
    border: { url: null, el: null, color: '#c47b1a', tint: 0.4,  scale: 1, rot: 0, ...(restore?.palette?.border || {}) },
    // ground: base fabric colour behind the motif; auto-matched to the motif
    // until the user picks one (groundAuto false)
    body:   { url: null, el: null, color: '#e01050', tint: 0.4,  scale: 1, rot: 0, ground: null, groundAuto: true, ...(restore?.palette?.body || {}) },
    pallu:  { url: null, el: null, color: '#4a2080', tint: 0.35, scale: 1, rot: 0, ...(restore?.palette?.pallu || {}) },
  });
  const [view, setView] = useState('layout');
  const [drapeStyle, setDrapeStyle] = useState(assets.style || 'normal');
  const navigate = useNavigate();
  const [yarnColors, setYarnColors] = useState([]);
  const [zoom, setZoom] = useState(0.75); // flat template opens at the 75% preset
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [usage, refreshUsage] = useUsage();         // X / 15 outputs used today
  const usageBlocked = Boolean(usage?.blocked);
  const closeTools = useCallback(() => setToolsOpen(false), []);
  const canvasRef = useRef(null);
  const imgsRef = useRef(imgs);
  useEffect(() => { imgsRef.current = imgs; }, [imgs]);

  // Small JPEG copies of the three swatches, saved with the collection entry so the
  // layout can be re-opened and edited later (object URLs do not survive a reload)
  const getImages = useCallback(() => {
    const out = {};
    ['body', 'border', 'pallu'].forEach((key) => {
      const el = imgsRef.current[key]?.el;
      if (!el || !el.width) return;
      const k = Math.min(1, 640 / Math.max(el.width, el.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(el.width * k));
      c.height = Math.max(1, Math.round(el.height * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(el, 0, 0, c.width, c.height);
      out[key] = c.toDataURL('image/jpeg', 0.8);
    });
    return out;
  }, []);
  const viewportRef = useRef(null);
  usePinchZoom(viewportRef, zoom, setZoom);

  // Fit the whole template inside the scroll viewport
  const fitToView = useCallback(() => {
    const box = viewportRef.current;
    const c = canvasRef.current;
    if (!box || !c) return;
    const r = c.getBoundingClientRect();
    const w = r.width / zoom;
    const h = r.height / zoom;
    if (!w || !h) return;
    setZoom(Math.max(0.1, Math.min(1, (box.clientWidth - 4) / w, (box.clientHeight || h) / h)));
  }, [zoom]);

  const specs = useMemo(() => computeSpecs(p), [p]);

  // ── After every client-side redraw of the template ──
  const handleDraw = useCallback((canvas) => {
    setYarnColors(extractYarnColors(canvas.getContext('2d'), canvas.width, canvas.height));
  }, []);

  // ── Lightweight snapshot for auto-save (no image data besides the thumbnail) ──
  const hasAssets = Boolean(assets.bodyImage || assets.borderImage || assets.palluImage);
  const saveConfig = useMemo(() => ({
    name: `Saree ${DRAPE_STYLES.find(d => d.key === drapeStyle)?.label ?? ''} drape`.trim(),
    drapeStyle,
    description: assets.description || '',
    assetNames: assets.assetNames || {},
    palette: Object.fromEntries(['body', 'border', 'pallu'].map(k =>
      [k, { color: imgs[k].color, tint: imgs[k].tint, scale: imgs[k].scale, rot: imgs[k].rot,
        ...(k === 'body' ? { ground: imgs.body.ground, groundAuto: imgs.body.groundAuto } : {}) }])),
    params: p,
  }), [drapeStyle, assets, imgs, p]);

  const setImg = useCallback((key, val) => setImgs(prev => ({ ...prev, [key]: val })), []);
  const patchImg = useCallback((key, patch) =>
    setImgs(prev => ({ ...prev, [key]: { ...prev[key], ...patch } })), []);

  // Auto-match the body ground to the uploaded body motif (one motif only:
  // whichever image is in the body slot). Re-runs when the motif changes or
  // the user switches back to "Match motif".
  const bodyEl = imgs.body.el;
  const bodyGroundAuto = imgs.body.groundAuto !== false;
  useEffect(() => {
    if (!bodyEl || !bodyGroundAuto) return;
    const g = dominantGround(bodyEl);
    if (g) patchImg('body', { ground: g });
  }, [bodyEl, bodyGroundAuto, patchImg]);

  // ── Auto-assemble from the assets handed over by the Design page ──
  useEffect(() => {
    let cancelled = false;
    const slots = { body: assets.bodyImage, border: assets.borderImage, pallu: assets.palluImage };
    Object.entries(slots).forEach(([key, url]) => {
      if (!url) return;
      loadImage(url)
        .then(el => { if (!cancelled) patchImg(key, { url, el }); })
        .catch(err => console.error(`Failed to load ${key} image`, err));
    });
    return () => { cancelled = true; };
  }, [assets, patchImg]);
  const setParam = (key) => (val) => setP(prev => ({ ...prev, [key]: val }));

  // ── Next Step: compile both outputs on the backend (saved to batches.json),
  //    then land on the Result page ──
  async function handleNextStep() {
    if (generating || usageBlocked) return;
    setGenerating(true);
    setGenError('');
    try {
      const batch = await generateBatch({
        assets,
        style: drapeStyle,
        description: assets.description,
        templateCanvas: canvasRef.current,
      });
      navigate(`/result/${batch.id}`, { state: { batch } });
    } catch (err) {
      console.error(err);
      setGenError(err.message || 'Generation failed. Please try again.');
      setGenerating(false);
      refreshUsage();   // a 429 means the limit / pause changed: show it
    }
  }

  // ── Export as BMP ──
  function exportBMP() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bmpData = encodeImageDataAsBMP(imgData);
    const blob = new Blob([bmpData], { type: 'image/bmp' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'saree_layout.bmp';
    a.click();
  }

  // ── Export as print-ready PDF via browser print ──
  function exportPrint() {
    const canvas = canvasRef.current;
    const dataURL = canvas.toDataURL('image/png');
    const specs = computeSpecs(p);
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Saree Layout</title>
      <style>
        body { margin: 0; background: #fff; font-family: Arial, sans-serif; }
        .page { display: flex; gap: 20px; padding: 20px; }
        img { width: 280px; flex-shrink: 0; }
        table { border-collapse: collapse; font-size: 12px; }
        th { background: #f0a030; color: #fff; padding: 5px 10px; text-align: left; }
        td { padding: 4px 10px; border-bottom: 1px solid #eee; }
        h2 { font-size: 14px; margin: 12px 0 6px; color: #333; }
        @media print { button { display: none; } }
      </style></head><body>
      <div style="padding:16px">
        <h1 style="font-size:18px; margin:0 0 16px">Saree Technical Specification</h1>
        <div class="page">
          <img src="${dataURL}" />
          <div>
            <h2>WARP ENDS</h2>
            <table>
              <tr><th>Section</th><th>Ends</th></tr>
              <tr><td>Left border</td><td>${specs.warpEnds.leftBorder}</td></tr>
              <tr><td>Body</td><td>${specs.warpEnds.body}</td></tr>
              <tr><td>Right border</td><td>${specs.warpEnds.rightBorder}</td></tr>
              <tr><td><strong>Total</strong></td><td><strong>${specs.warpEnds.total}</strong></td></tr>
            </table>
            <h2>JACQUARD HOOKS</h2>
            <table>
              <tr><th>Section</th><th>Hooks</th></tr>
              <tr><td>Each border</td><td>${specs.hooks.perBorder}</td></tr>
              <tr><td>Body</td><td>${specs.hooks.body}</td></tr>
              <tr><td>Per body repeat</td><td>${specs.hooks.perBodyRepeat}</td></tr>
              <tr><td><strong>Total</strong></td><td><strong>${specs.hooks.total}</strong></td></tr>
            </table>
            <h2>PICKS</h2>
            <table>
              <tr><th>Section</th><th>Picks</th></tr>
              <tr><td>Pallu</td><td>${specs.picks.pallu}</td></tr>
              <tr><td>Blend band</td><td>${specs.picks.blendBand}</td></tr>
              <tr><td>Motif row</td><td>${specs.picks.motifRow}</td></tr>
              <tr><td>Body repeat</td><td>${specs.picks.bodyRepeat}</td></tr>
            </table>
            <h2>REPEAT</h2>
            <table>
              <tr><th>Axis</th><th>Value</th></tr>
              <tr><td>Across</td><td>${specs.repeat.across}"</td></tr>
              <tr><td>Along</td><td>${specs.repeat.along}"</td></tr>
              <tr><td>Border repeats</td><td>${specs.repeat.borderRepeats}</td></tr>
              <tr><td>Border stretch</td><td>${specs.repeat.borderStretch}×</td></tr>
            </table>
          </div>
        </div>
      </div>
      <script>window.onload=()=>window.print();</script>
      </body></html>`);
    win.document.close();
  }

  // ── Sidebar tree: every design, transform and loom tool in one place ──
  const toolTree = [
    {
      key: 'colour', label: 'Colours', icon: Palette, keywords: 'palette colourway color tint',
      children: [
        { key: 'colourways', label: 'Colour combinations', icon: Palette, keywords: 'body border pallu color tint preset',
          render: () => <ColorPickerOverlay imgs={imgs} onChange={patchImg} /> },
      ],
    },
    {
      key: 'transform', label: 'Swatches & transform', icon: Layers, keywords: 'scale rotation rotate image motif upload',
      children: [
        { key: 'body', label: 'Body motifs', icon: Flower2, keywords: 'scale rotation clockwise ground base colour color',
          render: () => (<>
            <MotifUploader id="body" label="Body motif" slot={imgs.body} onChange={v => setImg('body', v)} />
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
              <span>
                <span className="block text-xs text-fg">Ground colour</span>
                <span className="block text-[11px] text-muted">
                  {imgs.body.groundAuto !== false
                    ? (imgs.body.el ? 'Matched to the motif' : 'Matches the motif once uploaded')
                    : 'Custom'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {imgs.body.groundAuto === false && (
                  <button type="button" onClick={() => patchImg('body', { groundAuto: true })}
                    className="sf-tap min-h-9 rounded-lg px-2 text-xs text-muted hover:text-fg">Match motif</button>
                )}
                <input type="color" aria-label="Body ground colour"
                  value={imgs.body.ground || imgs.body.color}
                  onChange={e => patchImg('body', { ground: e.target.value, groundAuto: false })}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-transparent" />
              </span>
            </div>
          </>) },
        { key: 'border', label: 'Border motifs', icon: Frame, keywords: 'scale rotation clockwise top bottom border gap strip edge spacing height',
          render: () => (<>
            <MotifUploader id="border" label="Border motif" slot={imgs.border} onChange={v => setImg('border', v)} />
            <div className="mt-4 border-t border-line pt-3">
              <Toggle label="Strip above top border" hint="Plain strip at the saree edge, outside the top border"
                checked={p.topGapOn} onChange={setParam('topGapOn')} />
              {p.topGapOn && (
                <NumInput label="Height" unit="cm" value={p.topGapCm} onChange={setParam('topGapCm')} min={0.1} max={30} step={0.5} />
              )}
              <Toggle label="Strip below bottom border" hint="Plain strip at the saree edge, outside the bottom border"
                checked={p.bottomGapOn} onChange={setParam('bottomGapOn')} />
              {p.bottomGapOn && (
                <NumInput label="Height" unit="cm" value={p.bottomGapCm} onChange={setParam('bottomGapCm')} min={0.1} max={30} step={0.5} />
              )}
              {(p.topGapOn || p.bottomGapOn) && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Strip colour</span>
                  <span className="flex items-center gap-2">
                    {p.gapColor && (
                      <button type="button" onClick={() => setParam('gapColor')('')}
                        className="sf-tap min-h-9 rounded-lg px-2 text-xs text-muted hover:text-fg">Use body</button>
                    )}
                    <input type="color" aria-label="Strip colour" value={p.gapColor || imgs.body.color}
                      onChange={e => setParam('gapColor')(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-transparent" />
                  </span>
                </div>
              )}
            </div>
          </>) },
        { key: 'pallu', label: 'Pallu image', icon: ImageIcon, keywords: 'scale rotation clockwise',
          render: () => <MotifUploader id="pallu" label="Pallu image" slot={imgs.pallu} onChange={v => setImg('pallu', v)} /> },
      ],
    },
    {
      key: 'loom', label: 'Loom parameters', icon: Ruler, keywords: 'inspect specs cad',
      children: [
        { key: 'dims', label: 'Dimensions', icon: Maximize2, keywords: 'epi ppi width border body',
          render: () => (<>
            <NumInput label="EPI (ends per inch)" unit="ends/in" value={p.epi} onChange={setParam('epi')} min={1} />
            <NumInput label="PPI (picks per inch)" unit="picks/in" value={p.ppi} onChange={setParam('ppi')} min={1} />
            <NumInput label="Left border width" unit="inches" value={p.leftBorderIn} onChange={setParam('leftBorderIn')} step={0.5} />
            <NumInput label="Right border width" unit="inches" value={p.rightBorderIn} onChange={setParam('rightBorderIn')} step={0.5} />
            <NumInput label="Body width" unit="inches" value={p.bodyWidthIn} onChange={setParam('bodyWidthIn')} step={0.5} />
            <p className="mb-3 text-xs text-muted">
              Total width: {(p.leftBorderIn + p.bodyWidthIn + p.rightBorderIn).toFixed(1)}"
              {(p.topGapOn || p.bottomGapOn) && (() => {
                const cm = (p.topGapOn ? p.topGapCm : 0) + (p.bottomGapOn ? p.bottomGapCm : 0);
                return ` + ${cm} cm edge strips = ${(p.leftBorderIn + p.bodyWidthIn + p.rightBorderIn + cm / 2.54).toFixed(2)}"`;
              })()}
            </p>
          </>) },
        { key: 'length', label: 'Length (true scale)', icon: MoveVertical, keywords: 'saree blouse metres',
          render: () => (<>
            <NumInput label="Saree length" unit="inches" value={p.sareeLenIn} onChange={setParam('sareeLenIn')} min={60} />
            <NumInput label="Blouse piece" unit="inches" value={p.blousePieceIn} onChange={setParam('blousePieceIn')} />
            <p className="text-xs text-muted">
              Total: {(p.sareeLenIn + p.blousePieceIn).toFixed(0)}" ≈ {((p.sareeLenIn + p.blousePieceIn) * 0.0254).toFixed(2)} m
            </p>
          </>) },
        { key: 'pallublend', label: 'Pallu & blend', icon: GalleryHorizontal, keywords: 'pallu length blend band',
          render: () => (<>
            <NumInput label="Pallu length" unit="inches" value={p.palluLenIn} onChange={setParam('palluLenIn')} step={0.5} />
            <NumInput label="Blend band" unit="inches" value={p.blendIn} onChange={setParam('blendIn')} step={0.5} />
          </>) },
        { key: 'repeat', label: 'Motif repeat', icon: Repeat, keywords: 'repeats across along height',
          render: () => (<>
            <NumInput label="Repeats across body" unit="count" value={p.motifRepsAcross} onChange={setParam('motifRepsAcross')} min={1} />
            <NumInput label="Repeat along (motif height)" unit="inches" value={p.motifAlong} onChange={setParam('motifAlong')} min={0.5} step={0.5} />
          </>) },
        { key: 'hooks', label: 'Jacquard hooks', icon: Grid3x3, keywords: 'hooks border body',
          render: () => (<>
            <NumInput label="Hooks per border" unit="hooks" value={p.borderHooks} onChange={setParam('borderHooks')} min={1} />
            <NumInput label="Hooks for body" unit="hooks" value={p.bodyHooks} onChange={setParam('bodyHooks')} min={1} />
            <p className="mb-3 text-xs leading-relaxed text-muted">
              Woven resolution: border {specs.resolution.border.toFixed(1)} hooks/in ·
              body {specs.resolution.body.toFixed(1)} hooks/in ({specs.hooks.perBodyRepeat} per repeat).
              {specs.resolution.coarse
                ? <span className="text-gold"> Below 6/in: motifs coarsen in the preview.</span>
                : ' The preview coarsens motifs once this drops below 6/in.'}
            </p>
            <button type="button" onClick={() => setP({ ...DEF })}
              className={`${tap} mt-1 w-full border border-line bg-surface text-fg`}>
              <RefreshCw size={14} /> Reset loom defaults
            </button>
          </>) },
      ],
    },
  ];

  // ── UI ──
  const zoomPct = Math.round(zoom * 100);
  const presetActive = (v) => Math.abs(zoom - v) < 0.005;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-4 sm:px-6 xl:px-8">

      <CollectionAutoSaver canvasRef={canvasRef} config={saveConfig} hasAssets={hasAssets}
        getImages={getImages} sessionId={restore?.id} />
      {(generating || genError) && (
        <GeneratingOverlay error={genError} onRetry={handleNextStep} onDismiss={() => setGenError('')} />
      )}

      {/* Header */}
      <header className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-gold sm:text-3xl">Simulation studio</h1>
          <p className="text-xs text-muted sm:text-sm">Flat template · CAD. Changes auto-save to your collection on exit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setToolsOpen(true)} aria-label="Open studio tools"
            className={`${tap} shrink-0 border border-gold/60 bg-surface text-gold xl:hidden`}>
            <PanelLeftOpen size={16} /> Tools
          </button>
          <button type="button" onClick={() => navigate(-1)} className={`${tap} shrink-0 border border-line bg-surface text-fg`}>
            <ArrowLeft size={16} /> Back
          </button>
          <button type="button" onClick={() => navigate('/collections')} className={`${tap} shrink-0 border border-line bg-surface text-fg`}>
            <LogOut size={16} /> Exit
          </button>
          <button type="button" onClick={exportBMP} className={`${tap} shrink-0 border border-line bg-surface text-fg`}>
            <Download size={16} /> BMP
          </button>
          <button type="button" onClick={exportPrint} className={`${tap} shrink-0 border border-line bg-surface text-fg`}>
            <Printer size={16} /> PDF
          </button>
          {usage && (
            <span className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-semibold tabular-nums ${
              usageBlocked ? 'border-red-400/50 text-red-300' : 'border-line text-muted'}`}
              title={usageMessage(usage) || `${usage.remaining} outputs left today`}>
              {usage.paused ? 'Paused' : `${usage.used} / ${usage.limit}`}
              <span className="font-normal">{usage.paused ? 'by admin' : 'outputs today'}</span>
            </span>
          )}
          <button type="button" onClick={handleNextStep} disabled={generating || usageBlocked}
            className={`${tap} shrink-0 bg-gradient-to-br from-[#f2d874] to-gold text-[#1d1700] shadow-[0_8px_22px_rgba(201,162,39,0.3)] disabled:opacity-60`}>
            Next step <ArrowRight size={16} />
          </button>
        </div>
      </header>
      {usageBlocked && (
        <p role="status" className="-mt-2 mb-4 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          {usageMessage(usage)}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">

        {/* ── Single tool sidebar (drawer below xl) ── */}
        <StudioSidebar tree={toolTree} open={toolsOpen} onClose={closeTools}
          defaultOpen={['colour', 'transform', 'body']} />

        {/* ── Viewport ── */}
        <main className="min-w-0 space-y-3">
          <div className={`${panel} p-2`}>
            <div role="tablist" className="grid grid-cols-2 gap-1.5">
              {VIEWS.map(v => (
                <button key={v.key} type="button" role="tab" aria-selected={v.key === view}
                  onClick={() => { haptic(); setView(v.key); }}
                  className={`sf-tap min-h-11 rounded-xl px-2 text-[13px] font-semibold sm:text-sm ${v.key === view ? 'bg-gold text-[#1d1700] shadow' : 'text-muted'}`}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className={`${panel} relative p-2 sm:p-3`}>
            {view === 'cad' && <div className="overflow-auto"><CadViewer params={p} specs={specs} imgs={imgs} /></div>}

            {/* The layout canvas stays mounted: it feeds yarn colours and the auto-save thumbnail */}
            <div className={view === 'layout' ? 'block' : 'hidden'}>
              <div ref={viewportRef}
                className="max-h-[62vh] touch-pan-x touch-pan-y overflow-auto rounded-xl border border-line bg-black/10 xl:max-h-[72vh]">
                <SimulationCanvas canvasRef={canvasRef} params={p} imgs={imgs} zoom={zoom} onDraw={handleDraw} />
              </div>
              <p className="mt-2 text-center text-[11px] text-muted">
                ◀ {p.leftBorderIn}" border · {p.bodyWidthIn}" body · border {p.rightBorderIn}" ▶ · pinch to zoom, drag to pan
              </p>
            </div>
          </div>

          {/* Floating zoom toolbar. Lives outside the blurred card: backdrop-filter would
              otherwise become the containing block for position:fixed. */}
          {view === 'layout' && (
  <div role="toolbar" aria-label="Zoom"
    className="relative z-[145] mx-auto flex w-fit items-center gap-1 rounded-2xl border border-line bg-glass p-1.5 shadow-2xl backdrop-blur-xl lg:sticky lg:bottom-3 lg:left-auto lg:mx-auto lg:w-fit lg:translate-x-0 lg:shadow-lg">
    {[['75%', () => setZoom(0.75), presetActive(0.75)], ['100%', () => setZoom(1), presetActive(1)], ['Fit', fitToView, false]].map(([label, fn, on]) => (
      <button key={label} type="button" onClick={() => { haptic(); fn(); }}
        className={`sf-tap min-h-11 min-w-14 rounded-xl px-3 text-sm font-bold ${on ? 'bg-gold text-[#1d1700]' : 'text-fg'}`}>
        {label}
      </button>
    ))}
    <span className="min-w-12 px-1 text-center text-xs tabular-nums text-muted">{zoomPct}%</span>
  </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <StatCard title="Warp ends" rows={[
              ['Left border', specs.warpEnds.leftBorder], ['Body', specs.warpEnds.body],
              ['Right border', specs.warpEnds.rightBorder], ['Total', specs.warpEnds.total]]} />
            <StatCard title="Jacquard hooks" rows={[
              ['Each border', specs.hooks.perBorder], ['Body', specs.hooks.body],
              ['Per body repeat', specs.hooks.perBodyRepeat], ['Total', specs.hooks.total]]} />
            <StatCard title="Picks" rows={[
              ['Pallu', specs.picks.pallu], ['Blend band', specs.picks.blendBand],
              ['Motif row', specs.picks.motifRow], ['Body repeat', specs.picks.bodyRepeat]]} />
            <StatCard title="Repeat" rows={[
              ['Across', `${specs.repeat.across}"`], ['Along', `${specs.repeat.along}"`],
              ['Border repeats', specs.repeat.borderRepeats], ['Border stretch', `${specs.repeat.borderStretch}×`]]} />
          </div>

          {yarnColors.length > 0 && (
            <div className={`${panel} p-4`}>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gold">
                Yarn colours in the loom files ({yarnColors.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {yarnColors.map(({ hex, pct }) => (
                  <span key={hex} className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-1 pr-3 text-xs text-fg">
                    <span className="h-5 w-5 rounded-full border border-line" style={{ background: hex }} />
                    {hex} · {pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
