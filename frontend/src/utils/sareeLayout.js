// ─── Saree layout: the single source of truth for the Simulation tab ─────────
// Both views (Flat template canvas and CAD sketch) and the telemetry cards
// derive everything from computeLayout(p) / computeSpecs(p), so a change to
// any loom parameter or motif transform shows up identically in all of them.
//
// Units are inches. Screen orientation, shared by both views (left → right):
//   [ pallu | blend | body ........................ | blouse piece ]
// and top → bottom:
//   [ top strip ] [ top border = loom right border ] [ body field ]
//   [ bottom border = loom left border ] [ bottom strip ]
// Both borders are warp: they run unbroken the full length, through the
// pallu — never a perpendicular bar across it.

export const DEFAULT_PARAMS = Object.freeze({
  epi: 120, ppi: 80,
  leftBorderIn: 6, rightBorderIn: 6, bodyWidthIn: 36,
  sareeLenIn: 216, blousePieceIn: 32, // 5.5 m saree + 0.8 m blouse piece
  palluLenIn: 45.6, blendIn: 3, motifAlong: 24,
  motifRepsAcross: 3, borderHooks: 480, bodyHooks: 1920,
  topGapOn: false,   // optional plain strip above the top border (saree edge)
  topGapCm: 1,
  bottomGapOn: true, // plain strip below the bottom border, 1 cm by default
  bottomGapCm: 1,
  gapColor: '',      // '' = body ground colour, lightened
});

export const CM_PER_IN = 2.54;
// Below this many hooks/in the 6 px/in preview visibly coarsens motifs
export const PREVIEW_PX_PER_IN = 6;

const pos = (v, floor = 0) => (Number.isFinite(v) ? Math.max(floor, v) : floor);

// Geometry, in inches, from the loom parameters
export function computeLayout(p) {
  const top = pos(p.rightBorderIn);
  const bottom = pos(p.leftBorderIn);
  const body = pos(p.bodyWidthIn);
  const topStrip = p.topGapOn ? pos(p.topGapCm) / CM_PER_IN : 0;
  const bottomStrip = p.bottomGapOn !== false ? pos(p.bottomGapCm) / CM_PER_IN : 0;

  const sareeLen = pos(p.sareeLenIn, 1);
  const blouse = pos(p.blousePieceIn);
  const pallu = Math.min(pos(p.palluLenIn), sareeLen);
  const blend = Math.min(pos(p.blendIn), pallu);
  const reps = Math.max(1, Math.round(p.motifRepsAcross || 1));

  // y positions (top → bottom)
  const yTopBorder = topStrip;
  const yField = yTopBorder + top;
  const yBottomBorder = yField + body;
  const yBottomStrip = yBottomBorder + bottom;
  const width = yBottomStrip + bottomStrip;

  // x positions (left → right)
  const xBlendStart = pallu - blend;   // body starts under the cross-fade
  const xBlouse = sareeLen;
  const length = sareeLen + blouse;

  // Hooks per inch actually woven: hooks spread over the section width,
  // never finer than EPI (a hook lifts at least one end)
  const res = (hooks, widthIn) => Math.min(pos(p.epi, 1), pos(hooks, 1) / Math.max(0.1, widthIn));

  return {
    width, length,
    strips: { top: topStrip, bottom: bottomStrip },
    borders: { top, bottom, yTop: yTopBorder, yBottom: yBottomBorder },
    field: { y: yField, h: body },
    pallu: { len: pallu, blend, xBlendStart },
    body: { x: xBlendStart, len: sareeLen - xBlendStart },
    blouse: { x: xBlouse, len: blouse },
    stripY: { top: 0, bottom: yBottomStrip },
    // Body repeat cell: (body width / repeats across) × repeat along
    repeat: { across: body / reps, along: Math.max(0.5, pos(p.motifAlong, 0.5)), reps },
    hooksPerIn: {
      top: res(p.borderHooks, top),
      bottom: res(p.borderHooks, bottom),
      body: res(p.bodyHooks, body),
    },
    ppi: pos(p.ppi, 1),
  };
}

// Loom specs for the telemetry cards, print sheet and CAD legend
export function computeSpecs(p) {
  const L = computeLayout(p);
  const totalWarpIn = L.borders.top + L.field.h + L.borders.bottom;
  const along = L.repeat.along;
  const borderRepeats = Math.ceil(L.pallu.len / Math.max(0.1, along)) || 0;
  return {
    warpEnds: {
      leftBorder: Math.round(p.epi * p.leftBorderIn),
      body:       Math.round(p.epi * p.bodyWidthIn),
      rightBorder:Math.round(p.epi * p.rightBorderIn),
      total:      Math.round(p.epi * totalWarpIn),
    },
    hooks: {
      perBorder:     p.borderHooks,
      body:          p.bodyHooks,
      perBodyRepeat: Math.round(p.bodyHooks / L.repeat.reps),
      total:         2 * p.borderHooks + p.bodyHooks,
    },
    picks: {
      pallu:       Math.round(p.ppi * L.pallu.len),
      blendBand:   Math.round(p.ppi * L.pallu.blend),
      motifRow:    Math.round(p.ppi * (along / 2)),
      bodyRepeat:  Math.round(p.ppi * along),
    },
    repeat: {
      across:        L.repeat.across.toFixed(1),
      along:         along.toFixed(1),
      borderRepeats,
      borderStretch: borderRepeats ? (L.pallu.len / (borderRepeats * along)).toFixed(3) : '1.000',
    },
    resolution: {
      border: Math.min(L.hooksPerIn.top, L.hooksPerIn.bottom),
      body: L.hooksPerIn.body,
      coarse: Math.min(L.hooksPerIn.top, L.hooksPerIn.bottom, L.hooksPerIn.body) < PREVIEW_PX_PER_IN,
    },
    layout: L,
  };
}
