// ─── CAD simulation: flat technical sketch of the full saree ─────────────────
// Drawn from the same computeLayout() as the flat template, in the same
// orientation (pallu left → body → blouse piece right; top strip, top border,
// body, bottom border, bottom strip), so both views always agree.
// SVG units are inches.
import { computeLayout } from '../../utils/sareeLayout';

const fmt = (v, d = 1) => Number(v).toFixed(d).replace(/\.0+$/, '');

export default function CadViewer({ params: p, specs, imgs }) {
  const L = computeLayout(p);
  const body = imgs?.body || {};
  const border = imgs?.border || {};
  const pallu = imgs?.pallu || {};

  const M = 18;
  const vbW = L.length + M * 2;
  const vbH = L.width + M * 2.8;
  const x0 = M, y0 = M;
  const X = (x) => x0 + x;
  const Y = (y) => y0 + y;

  const fieldTop = Y(L.field.y);
  const fieldBot = Y(L.field.y + L.field.h);
  const xBody = X(L.pallu.len);              // body proper, after the blend
  const xEnd = X(L.length);

  // Body repeat grid: the same cell the flat template tiles (× motif scale),
  // starting under the blend and running through the blouse piece
  const s = body.scale || 1;
  const cellAlong = L.repeat.along * s;
  const cellAcross = L.repeat.across * s;
  // Lattice exactly as the flat template weaves it: anchored at the body's
  // top-left, the whole plane turned clockwise about the field centre and
  // overscanned by the diagonal, then clipped to the field
  const fx = X(L.body.x), fw = L.body.len + L.blouse.len;
  const fcx = fx + fw / 2, fcy = fieldTop + L.field.h / 2;
  const rot = ((body.rot || 0) % 360 + 360) % 360;
  const R = rot ? Math.hypot(fw, L.field.h) / 2 + Math.max(cellAlong, cellAcross) : 0;
  const halfW = rot ? R : fw / 2, halfH = rot ? R : L.field.h / 2;
  const ax = fx - fcx, ay = fieldTop - fcy;
  const gridV = [], gridH = [];
  for (let i = Math.floor((-halfW - ax) / cellAlong) + 1; ax + i * cellAlong < halfW && gridV.length < 3000; i++) gridV.push(ax + i * cellAlong);
  for (let j = Math.floor((-halfH - ay) / cellAcross) + 1; ay + j * cellAcross < halfH && gridH.length < 1000; j++) gridH.push(ay + j * cellAcross);

  const stroke = '#7fb3ff';
  const dim = '#f0a030';
  const seam = '#ff6b6b';
  const fs = 3.2;
  const bandFill = 'rgba(240,160,48,0.12)';
  const stripFill = p.gapColor ? `${p.gapColor}55` : 'rgba(200,220,255,0.18)';
  const xf = (slot) => `${Math.round((slot.scale || 1) * 100)}% ↻${Math.round(slot.rot || 0)}°`;

  return (
    <div style={{ width: '100%', background: '#0d1b2e', borderRadius: 8, padding: 12,
      border: '1px solid #2a2d42', boxSizing: 'border-box' }}>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        fontFamily="monospace">
        <defs>
          <pattern id="cadGrid" width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M 6 0 L 0 0 0 6" fill="none" stroke="#16304f" strokeWidth="0.2" />
          </pattern>
          <marker id="arr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L6,3 L0,6 z" fill={dim} />
          </marker>
          <clipPath id="cadField">
            <rect x={X(L.body.x)} y={fieldTop} width={L.body.len + L.blouse.len} height={L.field.h} />
          </clipPath>
        </defs>
        <rect width={vbW} height={vbH} fill="url(#cadGrid)" />

        {/* Edge strips (outside the borders) */}
        {L.strips.top > 0 && (
          <rect x={X(0)} y={Y(0)} width={L.length} height={L.strips.top}
            fill={stripFill} stroke={stroke} strokeWidth="0.2" strokeDasharray="0.6 0.6" />
        )}
        {L.strips.bottom > 0 && (
          <rect x={X(0)} y={Y(L.stripY.bottom)} width={L.length} height={L.strips.bottom}
            fill={stripFill} stroke={stroke} strokeWidth="0.2" strokeDasharray="0.6 0.6" />
        )}

        {/* Pallu, blend, body, blouse piece — all between the borders */}
        <rect x={X(0)} y={fieldTop} width={L.pallu.xBlendStart} height={L.field.h}
          fill="rgba(224,16,80,0.10)" stroke={stroke} strokeWidth="0.5" />
        <rect x={X(L.pallu.xBlendStart)} y={fieldTop} width={L.pallu.blend} height={L.field.h}
          fill="rgba(127,179,255,0.15)" stroke={stroke} strokeWidth="0.3" strokeDasharray="1 1" />
        <rect x={xBody} y={fieldTop} width={L.blouse.x - L.pallu.len} height={L.field.h}
          fill={body.ground ? `${body.ground}40` : 'none'} stroke={stroke} strokeWidth="0.4" />
        {L.blouse.len > 0 && (
          <rect x={X(L.blouse.x)} y={fieldTop} width={L.blouse.len} height={L.field.h}
            fill="rgba(127,179,255,0.06)" stroke={stroke} strokeWidth="0.4" />
        )}

        {/* Repeat grid in the body (same cells as the flat template) */}
        <g clipPath="url(#cadField)">
          <g transform={`translate(${fcx} ${fcy}) rotate(${rot})`}
            stroke="#3d6ea8" strokeWidth="0.2" strokeDasharray="0.8 0.8">
            {gridV.map((x) => <line key={`v${x}`} x1={x} y1={-halfH} x2={x} y2={halfH} />)}
            {gridH.map((y) => <line key={`h${y}`} x1={-halfW} y1={y} x2={halfW} y2={y} />)}
          </g>
        </g>

        {/* Continuous warp borders, full length through the pallu */}
        <rect x={X(0)} y={Y(L.borders.yTop)} width={L.length} height={L.borders.top}
          fill={bandFill} stroke={stroke} strokeWidth="0.4" />
        <rect x={X(0)} y={Y(L.borders.yBottom)} width={L.length} height={L.borders.bottom}
          fill={bandFill} stroke={stroke} strokeWidth="0.4" />

        {/* Seams: border-to-body joins (full length), pallu and blouse joins */}
        {[fieldTop, fieldBot].map((y) => (
          <line key={`s${y}`} x1={X(0)} y1={y} x2={xEnd} y2={y}
            stroke={seam} strokeWidth="0.35" strokeDasharray="2 1" />
        ))}
        {[xBody, ...(L.blouse.len > 0 ? [X(L.blouse.x)] : [])].map((x) => (
          <line key={`j${x}`} x1={x} y1={fieldTop} x2={x} y2={fieldBot}
            stroke={seam} strokeWidth="0.35" strokeDasharray="2 1" />
        ))}

        {/* Labels */}
        <g fill="#cfe0ff" fontSize={fs}>
          <text x={X(2)} y={Y(L.borders.yTop + L.borders.top / 2 + 1)}>
            TOP BORDER {fmt(L.borders.top)}" · {fmt(L.hooksPerIn.top)} hooks/in · {xf(border)}
          </text>
          <text x={X(2)} y={Y(L.borders.yBottom + L.borders.bottom / 2 + 1)}>
            BOTTOM BORDER {fmt(L.borders.bottom)}" · {fmt(L.hooksPerIn.bottom)} hooks/in · {xf(border)}
          </text>
          <text x={xBody + 3} y={fieldTop + 5}>
            BODY · repeat {fmt(L.repeat.across)}" × {fmt(L.repeat.along)}" · {L.repeat.reps} across · {fmt(L.hooksPerIn.body)} hooks/in · {xf(body)}
          </text>
          <text x={X(2)} y={fieldTop + L.field.h / 2}>PALLU {fmt(L.pallu.len)}"</text>
          <text x={X(2)} y={fieldTop + L.field.h / 2 + 4.5}>{xf(pallu)}</text>
          {L.blouse.len > 0 && (
            <text x={X(L.blouse.x) + 2} y={fieldTop + L.field.h / 2}>BLOUSE {fmt(L.blouse.len)}"</text>
          )}
          {L.strips.top > 0 && <text x={X(L.length) - 2} y={Y(L.strips.top) - 0.3} textAnchor="end" fontSize={fs * 0.7}>strip {fmt(p.topGapCm)} cm</text>}
          {L.strips.bottom > 0 && <text x={X(L.length) - 2} y={Y(L.width) - 0.3} textAnchor="end" fontSize={fs * 0.7}>strip {fmt(p.bottomGapCm)} cm</text>}
        </g>

        {/* Dimension: overall length */}
        <line x1={X(0)} y1={Y(L.width) + 7} x2={xEnd} y2={Y(L.width) + 7}
          stroke={dim} strokeWidth="0.3" markerStart="url(#arr)" markerEnd="url(#arr)" />
        <text x={X(L.length / 2)} y={Y(L.width) + 12} fill={dim} fontSize={fs} textAnchor="middle">
          {fmt(L.length)}" overall · pallu {fmt(L.pallu.len)}" · blend {fmt(L.pallu.blend)}" · body {fmt(L.blouse.x - L.pallu.len)}" · blouse {fmt(L.blouse.len)}"
        </text>

        {/* Dimension: width */}
        <line x1={X(0) - 7} y1={Y(0)} x2={X(0) - 7} y2={Y(L.width)}
          stroke={dim} strokeWidth="0.3" markerStart="url(#arr)" markerEnd="url(#arr)" />
        <text x={X(0) - 9} y={Y(L.width / 2)} fill={dim} fontSize={fs} textAnchor="middle"
          transform={`rotate(-90 ${X(0) - 9} ${Y(L.width / 2)})`}>{fmt(L.width, 2)}" width · body {fmt(L.field.h)}"</text>
      </svg>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10, fontSize: 11, color: '#9ab' }}>
        <span><b style={{ color: seam }}>- - -</b> seam / join</span>
        <span><b style={{ color: '#3d6ea8' }}>····</b> repeat grid</span>
        <span>Border : body scale = 1 : {(L.field.h / Math.max(0.1, L.borders.bottom)).toFixed(2)}</span>
        <span>Border repeats in pallu: {specs.repeat.borderRepeats} (stretch {specs.repeat.borderStretch}×)</span>
        <span>Warp ends: {specs.warpEnds.total}</span>
        <span>Hooks/repeat: {specs.hooks.perBodyRepeat}</span>
        {specs.resolution.coarse && <span style={{ color: dim }}>Low hook density: motifs coarsen in the preview</span>}
      </div>
    </div>
  );
}
