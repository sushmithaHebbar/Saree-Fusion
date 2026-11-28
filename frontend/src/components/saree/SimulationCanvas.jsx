import { useEffect } from 'react';
import { computeLayout, PREVIEW_PX_PER_IN } from '../../utils/sareeLayout';

// ─── Flat saree template at true proportions ─────────────────────────────────
// Pure composition: the source images are only drawn, never modified.
// 1 inch = PX_PER_IN canvas pixels, so the canvas is the real saree aspect
// (e.g. 48" × (216" saree + 32" blouse piece) → 1488 × 288 px).
//
// Drawn in loom order (top → bottom: pallu, body, blouse piece, with both
// warp borders running the full length), laid out in screen space as the
// flat layout orientation of the reference template:
//   ═══════════════ top border (continuous) ═══════════════
//   [ pallu (weft) | body                  | blouse piece ]
//   ═══════════════ bottom border (continuous) ════════════
// Junctions are feathered (alpha-masked cross-fades) so the parts read as one
// woven textile, with no hard seams or bounding-box edges.
const PX_PER_IN = PREVIEW_PX_PER_IN;
const JOIN_FEATHER_PX = 3; // soft weave join where border meets body

// Canvas size from the shared layout (strips included: woven beyond the borders)
function templateSize(p) {
  const L = computeLayout(p);
  return { W: Math.round(L.width * PX_PER_IN), H: Math.round(L.length * PX_PER_IN) };
}

// Multiply-blend tint over a region (client-side colourway)
function tintRect(ctx, x, y, w, h, hex, alpha) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hex;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// Paint into an offscreen layer, fade the given edges to transparent, then
// composite — gives anti-aliased, seamless junctions between components.
function feathered(ctx, x, y, w, h, edges, paint) {
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(w));
  off.height = Math.max(1, Math.ceil(h));
  const o = off.getContext('2d');
  o.translate(-x, -y);
  paint(o);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'destination-in';
  for (const [side, px] of Object.entries(edges)) {
    if (!px) continue;
    const g = {
      top:    () => o.createLinearGradient(0, 0, 0, px),
      bottom: () => o.createLinearGradient(0, off.height, 0, off.height - px),
      left:   () => o.createLinearGradient(0, 0, px, 0),
      right:  () => o.createLinearGradient(off.width, 0, off.width - px, 0),
    }[side]();
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    o.fillStyle = g;
    o.fillRect(0, 0, off.width, off.height);
  }
  ctx.drawImage(off, x, y);
}

// ─── Jacquard resolution ─────────────────────────────────────────────────────
// A motif can never be finer than the loom can weave it: across the warp the
// design resolution is the hooks per inch (capped by EPI, since a hook lifts at
// least one end), along the length it is PPI. A drawn size of (w × h) px
// therefore holds only (w/PX · alongPerIn) × (h/PX · acrossPerIn) design
// cells; when that is below the pixel count the motif is resampled to those
// cells and drawn with hard edges, so too few hooks visibly coarsen it.
// res = { along, across } in cells per inch, in screen orientation.
const quantCache = new WeakMap();

function quantize(img, res, w, h) {
  if (!res) return { src: img, crisp: false };
  const cols = Math.max(1, Math.min(Math.round(w), Math.round((w / PX_PER_IN) * res.along)));
  const rows = Math.max(1, Math.min(Math.round(h), Math.round((h / PX_PER_IN) * res.across)));
  if (cols >= Math.round(w) && rows >= Math.round(h)) return { src: img, crisp: false };
  let byImg = quantCache.get(img);
  if (!byImg) { byImg = new Map(); quantCache.set(img, byImg); }
  const key = `${cols}x${rows}`;
  let c = byImg.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    c.getContext('2d').drawImage(img, 0, 0, cols, rows);
    byImg.set(key, c);
  }
  return { src: c, crisp: true };
}

// Upright tiles repeated along x, edge to edge (continuous, no gaps).
// - Default (borders): each tile is h × Scale tall, width from the motif's aspect.
// - opts.cell (body): a fixed repeat cell {w, h} in px (× Scale) that the
//   motif fills completely, so repeat across/along are exact.
// - opts.res: jacquard resolution (see quantize).
// - opts.ground: colour laid down first (shows through transparent motif areas).
// Rotation turns the whole lattice clockwise as one plane (no gaps).
function tileRow(ctx, slot, x, y, w, h, opts = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const img = slot.el;
  if (img) {
    const s = slot.scale || 1;
    const aspect = img.width / Math.max(1, img.height);
    // Whole-pixel tiles, each overlapping the next by 1 px: fractional tile
    // edges anti-alias into visible hairline division lines otherwise
    let th, tw, dw, dh;
    if (opts.cell) {
      th = Math.max(4, Math.round(opts.cell.h * s));
      tw = Math.max(4, Math.round(opts.cell.w * s));
      dw = tw; dh = th;
    } else {
      th = Math.max(8, Math.round(h * s));
      tw = Math.max(8, Math.round(th * aspect));
      dw = tw; dh = th;
    }
    // Ground behind the motif (shows through transparent motif areas)
    if (opts.ground) {
      ctx.fillStyle = opts.ground;
      ctx.fillRect(x, y, w, h);
    }
    const { src, crisp } = quantize(img, opts.res, dw, dh);
    ctx.imageSmoothingEnabled = !crisp;
    const pad = 1;
    const rad = ((slot.rot || 0) * Math.PI) / 180;
    // The lattice is anchored at the region's top-left (so it lines up with
    // the CAD repeat grid). Rotation turns the WHOLE lattice clockwise about
    // the region centre as one woven plane: tiles keep sharing edges, so no
    // holes open between them at any angle. The plane is overscanned by the
    // region's diagonal and clipped to the region.
    const cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    if (rad) ctx.rotate(rad);
    const R = rad ? Math.hypot(w, h) / 2 + Math.max(tw, th) : 0;
    const ax = Math.round(x - cx), ay = Math.round(y - cy);   // lattice anchor
    const halfW = rad ? R : w / 2, halfH = rad ? R : h / 2;
    const i0 = Math.floor((-halfW - ax) / tw), i1 = Math.ceil((halfW - ax) / tw);
    const j0 = Math.floor((-halfH - ay) / th), j1 = Math.ceil((halfH - ay) / th);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        ctx.drawImage(src, ax + i * tw, ay + j * th, dw + pad, dh + pad);
      }
    }
    ctx.restore(); ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  } else {
    ctx.fillStyle = opts.ground || slot.color;
    ctx.fillRect(x, y, w, h);
  }
  tintRect(ctx, x, y, w, h, slot.color, slot.tint);
  ctx.restore();
}

function drawTemplate(canvas, p, imgs) {
  const ctx = canvas.getContext('2d');
  const L = computeLayout(p);
  const { W, H } = templateSize(p);
  const px = (inches) => Math.round(inches * PX_PER_IN);
  const f = JOIN_FEATHER_PX;

  // All positions come from the shared layout (inches → px)
  const topBY = px(L.borders.yTop), rb = px(L.borders.top);
  const fieldY = px(L.field.y);
  const botBY = px(L.borders.yBottom), lb = W - botBY - px(L.strips.bottom);
  const fieldW = botBY - fieldY;
  const palluH = px(L.pallu.len);
  const blendH = Math.max(2, px(L.pallu.blend));   // pallu ↔ body cross-fade
  const topGapPx = topBY;
  const bottomGapPx = W - botBY - lb;

  // Jacquard resolution per section (cells per inch, screen orientation)
  const bodyRes = { along: L.ppi, across: L.hooksPerIn.body };
  const topRes = { along: L.ppi, across: L.hooksPerIn.top };
  const bottomRes = { along: L.ppi, across: L.hooksPerIn.bottom };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, H, W);
  ctx.fillStyle = '#f5f0eb';
  ctx.fillRect(0, 0, H, W);

  // 1. Body field between the borders, through the saree and the blouse piece:
  //    continuous repeat cells, (body width / repeats across) × repeat along,
  //    the motif filling each cell, woven at body-hook resolution.
  tileRow(ctx, imgs.body, palluH - blendH, fieldY, H - palluH + blendH, fieldW, {
    cell: { w: L.repeat.along * PX_PER_IN, h: fieldW / L.repeat.reps },
    res: bodyRes,
    ground: imgs.body.ground,   // matched to the motif's own ground colour
  });

  // 2. Pallu: panel at the left end between the borders, placed once, its
  //    inner edge cross-fading into the body. Scale zooms it and Rotation
  //    turns it clockwise.
  const pTop = fieldY;
  const pH = fieldW;
  const pw = palluH + blendH;
  feathered(ctx, 0, pTop, pw, pH, { right: blendH * 2 }, (o) => {
    const slot = imgs.pallu;
    o.save();
    o.beginPath();
    o.rect(0, pTop, pw, pH);
    o.clip();
    if (slot.el) {
      const s = slot.scale || 1;
      const { src, crisp } = quantize(slot.el, bodyRes, pw * s, pH * s);
      o.imageSmoothingEnabled = !crisp;
      o.translate(pw / 2, pTop + pH / 2);
      o.rotate(((slot.rot || 0) * Math.PI) / 180);
      o.scale(s, s);
      o.drawImage(src, -pw / 2, -pH / 2, pw, pH);
      o.setTransform(1, 0, 0, 1, 0, -pTop); // back to screen space of this layer
    } else {
      o.fillStyle = slot.color;
      o.fillRect(0, pTop, pw, pH);
      o.globalAlpha = 0.15;
      o.fillStyle = '#000';
      for (let x = 0; x < pw; x += px(4)) o.fillRect(x, pTop, px(1.5), pH);
      o.globalAlpha = 1;
    }
    tintRect(o, 0, pTop, pw, pH, slot.color, slot.tint);
    o.restore();
  });

  // 3. Warp borders at border-hook resolution, full length (through the
  //    pallu), each reaching f px into the field and fading there.
  feathered(ctx, 0, topBY, H, rb + f, { bottom: f }, (o) =>
    tileRow(o, imgs.border, 0, topBY, H, rb + f, { res: topRes }));
  feathered(ctx, 0, botBY - f, H, lb + f, { top: f }, (o) =>
    tileRow(o, imgs.border, 0, botBY - f, H, lb + f, { res: bottomRes }));

  // 4. Plain strips on the outer side of each border, when switched on.
  //    Custom colour, or the body ground lightened.
  const strip = (x, y, w, h) => {
    if (h <= 0 || w <= 0) return;
    ctx.fillStyle = p.gapColor || imgs.body.ground || imgs.body.color;
    ctx.fillRect(x, y, w, h);
    if (!p.gapColor) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, y, w, h);
    }
  };
  strip(0, 0, H, topGapPx);
  strip(0, botBY + lb, H, bottomGapPx);

  // 5. Blouse piece: same warp and body weave, so it continues seamlessly —
  //    no cut / division line is drawn
}

// ─── SimulationCanvas ────────────────────────────────────────────────────────
// onDraw lets the parent react to redraws (yarn colours, auto-save snapshot).
export default function SimulationCanvas({ canvasRef, params, imgs, zoom = 1, onDraw }) {
  const { W, H } = templateSize(params);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawTemplate(canvas, params, imgs);
    onDraw?.(canvas);
  }, [canvasRef, params, imgs, onDraw]);

  return (
    <canvas
      ref={canvasRef}
      width={H} height={W}
      style={{ display: 'block', width: Math.round(H * zoom), height: Math.round(W * zoom) }}
    />
  );
}
