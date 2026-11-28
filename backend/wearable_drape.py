"""Offline wearable drape: maps the exact uploaded swatches onto the mannequin.

100% local (OpenCV / NumPy). No API keys, no network.

Inputs: the mannequin photo plus three region masks (body, border, pallu) in
static/assets. The masks shipped with the project are noisy (hundreds of
specks in the pallu mask, pinholes between regions, overlaps), and the old
compositor pasted swatches through hard thresholds, which produced the dot
artifacts. This module:

0. Crops each swatch photo to the fabric itself (drops the studio
   background around it, which would otherwise tile as a grid).
1. Cleans the masks: drops specks, closes pinholes, smooths contours.
   The shipped masks come from colour segmentation of the photo, so the
   "pallu" mask is mostly the gold butti dots scattered over the body — the
   source of the dot artifacts. The real pallu panel is where those specks
   are dense; isolated specks are body butti and are returned to the body.
2. Makes the regions a partition: each saree pixel belongs to exactly one of
   body / border / pallu (priority border > pallu > body); gap pixels inside
   the drape go to the nearest region, so nothing of the old garment shows
   through.
3. Feathers every boundary (region↔region and drape↔background) with soft
   alpha that sums to the drape alpha, so seams blend without speckle.
4. Builds a shading map from the photo's large-scale light only (heavy
   edge-preserving smoothing removes the old print), normalised to mean 1
   inside the drape, so swatch colours are preserved on average.
5. Lays out each swatch faithfully: body tiled at its own aspect, border
   tiled at its own aspect, pallu placed once with aspect-preserving cover —
   never stretched, recoloured or redrawn.
"""

import os

import cv2
import numpy as np

# Tunables (pixels refer to the mannequin photo, 680 × 1024 shipped)
MIN_SPECK_AREA = 120        # components smaller than this are noise
CLOSE_KERNEL = 9            # closes pinholes / hairline gaps
FEATHER_SIGMA = 1.6         # soft edge between regions
OUTER_FEATHER_SIGMA = 1.2   # soft edge against the background
SHADE_SIGMA = 9             # removes the base garment's printed pattern
SHADE_RANGE = (0.55, 1.30)  # clamp so swatch colours are not crushed / blown
BODY_TILE_FRAC = 0.16       # body motif tile height as a fraction of image height
BORDER_TILE_FRAC = 0.06     # border band height as a fraction of image height


def _clean(mask, min_area=MIN_SPECK_AREA):
    """Binary mask → speck-free, pinhole-free, smooth-contoured binary mask."""
    if mask is None:
        return None
    m = (mask > 127).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_KERNEL, CLOSE_KERNEL))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = np.zeros(n, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    m = keep[labels].astype(np.uint8)
    # Fill interior holes (pinholes inside a region)
    inv = 1 - m
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    for i in range(1, n2):
        if st2[i, cv2.CC_STAT_AREA] < min_area * 4:
            m[lab2 == i] = 1
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    return m


def _crop_by_texture(img, pad_frac=0.06):
    """Fallback crop: fabric is detailed (weave, motifs), a backdrop is plain."""
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mag = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    k = max(9, (min(h, w) // 25) | 1)
    busy = cv2.blur(mag, (k, k))
    fg = (busy > 0.35 * np.percentile(busy, 90)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n <= 1:
        return img
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh = stats[i, :4]
    if bw * bh < 0.25 * h * w:
        return img
    px, py = int(bw * pad_frac), int(bh * pad_frac)
    return img[y + py:y + bh - py, x + px:x + bw - px]


def _crop_fabric(img, pad_frac=0.06):
    """Crop a swatch photo to the fabric, dropping a uniform studio background.

    The background colour is estimated from the image corners; the largest
    region that differs from it is the fabric. A small inset removes the
    frayed / shadowed edge. Returns the image unchanged when no clear
    background is found (e.g. an edge-to-edge fabric scan).
    """
    h, w = img.shape[:2]
    c = max(2, min(h, w) // 40)
    corners = np.concatenate([img[:c, :c].reshape(-1, 3), img[:c, -c:].reshape(-1, 3),
                              img[-c:, :c].reshape(-1, 3), img[-c:, -c:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    if corners.astype(np.float32).std(axis=0).mean() > 18:
        return _crop_by_texture(img, pad_frac)        # textured / uneven backdrop
    diff = np.linalg.norm(img.astype(np.float32) - bg, axis=2)
    fg = (diff > 38).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n <= 1:
        return _crop_by_texture(img, pad_frac)
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh = stats[i, :4]
    if bw * bh < 0.25 * h * w:
        return _crop_by_texture(img, pad_frac)
    px, py = int(bw * pad_frac), int(bh * pad_frac)
    return img[y + py:y + bh - py, x + px:x + bw - px]


def _pallu_panel(pallu_specks, sil):
    """Dense clusters of pallu specks = the pallu panel; lone specks are butti."""
    if pallu_specks is None:
        return np.zeros_like(sil)
    density = cv2.GaussianBlur(pallu_specks.astype(np.float32), (0, 0), 14)
    panel = (density > 0.22).astype(np.uint8)
    panel = cv2.morphologyEx(panel, cv2.MORPH_CLOSE,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(panel, connectivity=8)
    keep = np.zeros(n, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 2500     # a panel, not a cluster of butti
    return (keep[labels] & (sil > 0)).astype(np.uint8)


def _vote(masks, sigma):
    """Neighbourhood majority vote: 1-based index of the strongest blurred mask."""
    votes = np.stack([cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma) for m in masks])
    return np.argmax(votes, axis=0).astype(np.uint8) + 1


def _segment_by_colour(base_bgr, sil):
    """Body / border / pallu from the photo's own garment colours.

    Ground colours are distinctive while zari (gold) is shared by every
    region, so gold is left unvoted and the neighbourhood decides it — that
    folds butti dots and border motifs into their surrounding region instead
    of producing specks. Returns None when the photo does not separate into
    plausible regions (then the mask-based partition is used).
    """
    hsv = cv2.cvtColor(base_bgr, cv2.COLOR_BGR2HSV)
    H, S = hsv[:, :, 0].astype(np.int16), hsv[:, :, 1].astype(np.int16)
    inside = sil > 0
    hues = H[inside & (S > 60)]
    if hues.size < 500:
        return None
    # Body ground = the dominant saturated hue inside the drape
    hist = np.bincount((hues // 6).astype(np.int64), minlength=30)
    body_h = int(np.argmax(hist)) * 6 + 3
    hue_d = lambda h0: np.minimum(np.abs(H - h0), 180 - np.abs(H - h0))
    body = inside & (hue_d(body_h) <= 14) & (S > 70)
    # Remaining saturated hues: the most common is the border ground, a
    # second distinct cluster (if any, with lower saturation) is the pallu
    rest = inside & ~body & (S > 60)
    hist2 = np.bincount((H[rest] // 6).astype(np.int64), minlength=30)
    hist2[(body_h // 6 - 2) % 30:(body_h // 6 + 3)] = 0
    if hist2.sum() < 500:
        return None
    b_bin = int(np.argmax(hist2))
    border_h = b_bin * 6 + 3
    hist2[max(0, b_bin - 2):b_bin + 3] = 0
    border = rest & (hue_d(border_h) <= 12) & (S > 100)
    pallu = np.zeros_like(border)
    if hist2.max() > 0.08 * rest.sum():
        pallu_h = int(np.argmax(hist2)) * 6 + 3
        pallu = rest & (hue_d(pallu_h) <= 8) & (S < 170)

    lab = _vote((body, border, pallu), 7)
    lab[~inside] = 0
    # Which of the two non-body colours is the border? Borders are thin
    # bands, the pallu is a thick panel: compare typical thickness (distance
    # to the region edge) and swap if the colour guess was the wrong way round
    def thickness(k):
        m = (lab == k).astype(np.uint8)
        if not m.any():
            return 0.0
        d = cv2.distanceTransform(m, cv2.DIST_L2, 5)
        return float(np.percentile(d[m > 0], 90))
    if (lab == 3).any() and thickness(2) > thickness(3):
        lab = np.where(lab == 2, 3, np.where(lab == 3, 2, lab)).astype(np.uint8)
    # The pallu is a panel: keep its big component(s); small "pallu" bits are
    # border motifs and go back to the border
    pm = (lab == 3).astype(np.uint8)
    n, cc, st, _ = cv2.connectedComponentsWithStats(pm, connectivity=8)
    big = np.zeros(n, dtype=bool)
    big[1:] = st[1:, cv2.CC_STAT_AREA] >= 0.03 * inside.sum()
    lab[(pm > 0) & ~big[cc]] = 2
    # Final light vote smooths jagged region boundaries
    lab = _vote(((lab == 1), (lab == 2), (lab == 3)), 2.5)
    lab[~inside] = 0
    if (lab == 1).sum() < 0.15 * inside.sum():
        return None
    return lab


def _partition(body, border, pallu, base_bgr=None):
    """Exclusive labels 0=bg 1=body 2=border 3=pallu, gaps filled by nearest region."""
    h, w = next(m.shape for m in (body, border, pallu) if m is not None)
    z = np.zeros((h, w), np.uint8)
    body, border, pallu = [m if m is not None else z for m in (body, border, pallu)]

    # Drape silhouette = union of everything, closed and hole-filled
    union = ((body > 0) | (border > 0) | (pallu > 0)).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_KERNEL + 4, CLOSE_KERNEL + 4))
    sil = cv2.morphologyEx(union, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(sil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = [c for c in contours if cv2.contourArea(c) >= MIN_SPECK_AREA * 10]
    sil = np.zeros_like(sil)
    cv2.drawContours(sil, contours, -1, 1, thickness=cv2.FILLED)

    # Clean, hand-corrected masks (each region a few solid pieces) are used
    # exactly as drawn
    def pieces(m):
        return cv2.connectedComponents((m > 0).astype(np.uint8))[0] - 1
    if all(pieces(m) <= 4 for m in (body, border, pallu)) and pallu.any():
        labels = np.zeros((h, w), np.uint8)
        labels[body > 0] = 1
        labels[pallu > 0] = 3
        labels[border > 0] = 2
        sil = (labels > 0).astype(np.uint8)
        return labels, sil

    # Noisy masks: regions from the photo's own colours
    if base_bgr is not None:
        lab = _segment_by_colour(base_bgr, sil)
        if lab is not None:
            return lab, sil

    # Fallback: pallu panel from speck density; border bands from the border
    # mask outside the panel (cleaned of specks); body = the rest
    panel = _pallu_panel(pallu, sil)
    bands = _clean((((border > 0) & (panel == 0)) * 255).astype(np.uint8), min_area=MIN_SPECK_AREA * 4)
    labels = np.zeros((h, w), np.uint8)
    labels[sil > 0] = 1
    labels[(bands > 0) & (sil > 0)] = 2
    labels[panel > 0] = 3

    # Assign every uncovered silhouette pixel to its nearest region
    gaps = (sil > 0) & (labels == 0)
    if gaps.any():
        dists = []
        for lab in (1, 2, 3):
            src = (labels != lab).astype(np.uint8)   # 0 on the region
            if src.min() == 1:
                dists.append(np.full((h, w), np.inf, np.float32))
            else:
                dists.append(cv2.distanceTransform(src, cv2.DIST_L2, 5))
        nearest = np.argmin(np.stack(dists), axis=0).astype(np.uint8) + 1
        labels[gaps] = nearest[gaps]
    labels[sil == 0] = 0
    return labels, sil


def _soft_alphas(labels, sil):
    """Per-region soft alphas that sum to the (feathered) drape alpha."""
    outer = cv2.GaussianBlur(sil.astype(np.float32), (0, 0), OUTER_FEATHER_SIGMA)
    raw = [cv2.GaussianBlur((labels == lab).astype(np.float32), (0, 0), FEATHER_SIGMA)
           for lab in (1, 2, 3)]
    total = np.maximum(raw[0] + raw[1] + raw[2], 1e-6)
    return [r / total * outer for r in raw], outer


def _shading(base_bgr, sil):
    """Large-scale light/fold map from the photo, mean 1 inside the drape."""
    gray = cv2.cvtColor(base_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # Edge-preserving smoothing first (keeps fold edges), then a Gaussian to
    # wipe out the base garment's printed motifs and JPEG speckle
    smooth = cv2.bilateralFilter(gray, 9, 40, 9)
    smooth = cv2.GaussianBlur(smooth, (0, 0), SHADE_SIGMA)
    inside = sil > 0
    mean = float(smooth[inside].mean()) if inside.any() else 128.0
    shade = smooth / max(mean, 1.0)
    return np.clip(shade, *SHADE_RANGE)


def _flatten_lighting(img):
    """Remove the photo's slow lighting gradient so tiles join without steps.

    Divides out a heavily blurred luminance and restores the mean, so the
    swatch's pattern and average colour are unchanged.
    """
    f = img.astype(np.float32)
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    low = cv2.GaussianBlur(lum, (0, 0), max(img.shape[:2]) / 6)
    gain = (lum.mean() / np.maximum(low, 1.0))[:, :, None]
    f = f * gain
    # Residual row / column drift of the GROUND (what makes tile joins
    # visible). Medians track the ground and ignore zari motifs; smoothed
    # over more than one motif spacing so motifs themselves are untouched.
    sig = max(img.shape[:2]) / 18
    for axis in (1, 0):
        lum2 = f.mean(axis=2)
        prof = np.median(lum2, axis=axis).astype(np.float32).reshape(-1, 1)
        prof = cv2.GaussianBlur(prof, (1, 0), sigmaX=0.1, sigmaY=sig).ravel()
        g = float(np.median(prof)) / np.maximum(prof, 1.0)
        f = f * (g[:, None, None] if axis == 1 else g[None, :, None])
    return np.clip(f, 0, 255).astype(np.uint8)


def _tile(swatch, h, w, tile_h):
    """Tile a swatch across (h, w) at tile height tile_h, aspect preserved."""
    sh, sw = swatch.shape[:2]
    tile_h = max(8, int(round(tile_h)))
    tile_w = max(8, int(round(tile_h * sw / max(1, sh))))
    tile = cv2.resize(swatch, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
    reps_y = h // tile_h + 2
    reps_x = w // tile_w + 2
    return np.tile(tile, (reps_y, reps_x, 1))[:h, :w]


def _band_angles(region):
    """Direction each band runs, per pixel (degrees, image coords, -90..90).

    The gradient of the blurred band mask points across the band; a smoothed
    structure tensor turns that into a stable along-the-band angle that
    follows curves (shoulder → pleat, curved hem).
    """
    m = cv2.GaussianBlur(region.astype(np.float32), (0, 0), 6)
    gx = cv2.Sobel(m, cv2.CV_32F, 1, 0, ksize=5)
    gy = cv2.Sobel(m, cv2.CV_32F, 0, 1, ksize=5)
    s = 25
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), s)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), s)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), s)
    across = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy))
    return (across + 90 + 90) % 180 - 90


def _band_thickness(region):
    dt = cv2.distanceTransform(region.astype(np.uint8), cv2.DIST_L2, 5)
    vals = dt[region > 0]
    return float(2 * np.percentile(vals, 90)) if vals.size else 40.0


def _oriented_border(border, region, h, w, step=5, spread=1.5):
    """Border swatch laid along each band: its rows follow the band direction.

    The swatch is tiled with its height = the band width (so one full border
    design spans the band), rendered once per angle bin by rotating the tiled
    plane, and the bins are blended per pixel with smooth angular weights.
    """
    region = region > 0
    if not region.any():
        return np.zeros((h, w, 3), np.float32)
    ang = _band_angles(region)
    thick = _band_thickness(region)
    D = int(np.ceil(np.hypot(h, w))) + 4
    plane = _tile(border, D, D, thick).astype(np.float32)      # horizontal rows
    c = (D / 2.0, D / 2.0)

    out = np.zeros((h, w, 3), np.float32)
    wsum = np.zeros((h, w), np.float32)
    present = ang[region]
    for a in range(-90, 90, step):
        d = np.abs(((present - a) + 90) % 180 - 90)
        if (d < step).sum() < 30:
            continue
        # Rotate the plane so its rows run at angle a (image coords: y down,
        # so a positive angle is clockwise; OpenCV's angle is anticlockwise)
        M = cv2.getRotationMatrix2D(c, -a, 1.0)
        M[0, 2] += w / 2.0 - c[0]
        M[1, 2] += h / 2.0 - c[1]
        layer = cv2.warpAffine(plane, M, (w, h), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REFLECT)
        dd = np.abs(((ang - a) + 90) % 180 - 90)
        wt = np.exp(-(dd ** 2) / (2 * spread ** 2)) * region
        out += layer * wt[:, :, None]
        wsum += wt
    return out / np.maximum(wsum, 1e-6)[:, :, None]


def _cover(swatch, box_h, box_w):
    """Resize to cover (box_h, box_w) with aspect preserved, centre-cropped."""
    sh, sw = swatch.shape[:2]
    k = max(box_h / max(1, sh), box_w / max(1, sw))
    rs = cv2.resize(swatch, (max(1, int(np.ceil(sw * k))), max(1, int(np.ceil(sh * k)))),
                    interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    y0 = (rs.shape[0] - box_h) // 2
    x0 = (rs.shape[1] - box_w) // 2
    return rs[y0:y0 + box_h, x0:x0 + box_w]


def _pallu_layer(pallu, labels, h, w):
    """Pallu swatch placed once over the pallu region's bounding box."""
    layer = _tile(pallu, h, w, h * BODY_TILE_FRAC)    # safety fill outside the box
    ys, xs = np.where(labels == 3)
    if len(ys):
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        layer[y0:y1, x0:x1] = _cover(pallu, y1 - y0, x1 - x0)
    return layer


def _find_assets(assets_dir, demo_dir):
    names = ("mannequin_base.jpg", "mask_body.png", "mask_border.png", "mask_pallu.png")
    if os.path.exists(os.path.join(assets_dir, names[0])):
        root = assets_dir
    else:
        root, names = demo_dir, ("wearable_output.jpg",) + names[1:]
    return [os.path.join(root, n) for n in names]


def render_wearable(body_path, pallu_path, border_path, out_path, assets_dir, demo_dir):
    """Compose the wearable image. Returns True on success."""
    base_p, mb_p, mbr_p, mp_p = _find_assets(assets_dir, demo_dir)
    base = cv2.imread(base_p)
    body = cv2.imread(body_path)
    pallu = cv2.imread(pallu_path)
    border = cv2.imread(border_path)
    if base is None or body is None or pallu is None or border is None:
        print("Wearable drape: missing mannequin base or swatch.")
        return False
    h, w = base.shape[:2]
    body, border, pallu = _crop_fabric(body), _crop_fabric(border), _crop_fabric(pallu)

    def load_mask(p, clean=True):
        m = cv2.imread(p, cv2.IMREAD_GRAYSCALE) if os.path.exists(p) else None
        if m is not None and m.shape != (h, w):
            m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
        if m is None:
            return None
        return _clean(m) if clean else (m > 127).astype(np.uint8)

    # The pallu mask stays raw: its speck density locates the pallu panel
    labels, sil = _partition(load_mask(mb_p), load_mask(mbr_p), load_mask(mp_p, clean=False), base)
    if not sil.any():
        print("Wearable drape: masks are empty.")
        return False

    (a_body, a_border, a_pallu), a_all = _soft_alphas(labels, sil)
    shade = _shading(base, sil)[:, :, None]

    body_layer = _tile(_flatten_lighting(body), h, w, h * BODY_TILE_FRAC).astype(np.float32)
    # Border follows each band of the drape (shoulder, pleat border, hem)
    border_layer = _oriented_border(_flatten_lighting(border), labels == 2, h, w)
    pallu_layer = _pallu_layer(pallu, labels, h, w).astype(np.float32)

    fabric = (body_layer * a_body[:, :, None]
              + border_layer * a_border[:, :, None]
              + pallu_layer * a_pallu[:, :, None])
    fabric = fabric * shade
    out = base.astype(np.float32) * (1.0 - a_all[:, :, None]) + fabric
    out = np.clip(out, 0, 255).astype(np.uint8)

    ok = cv2.imwrite(out_path, out)
    return bool(ok)


def mask_report(assets_dir, demo_dir):
    """Diagnostics: specks, pinholes, overlaps before/after cleaning."""
    base_p, mb_p, mbr_p, mp_p = _find_assets(assets_dir, demo_dir)
    raw = [cv2.imread(p, cv2.IMREAD_GRAYSCALE) for p in (mb_p, mbr_p, mp_p)]
    out = {}
    for name, m in zip(("body", "border", "pallu"), raw):
        if m is None:
            continue
        n_raw = cv2.connectedComponents((m > 127).astype(np.uint8))[0] - 1
        n_clean = cv2.connectedComponents(_clean(m))[0] - 1
        out[name] = {"components_raw": n_raw, "components_clean": n_clean}
    b_, br_, p_ = raw
    labels, sil = _partition(_clean(b_), _clean(br_), None if p_ is None else (p_ > 127).astype(np.uint8),
                             cv2.imread(base_p))
    out["regions_px"] = {n: int((labels == i).sum()) for i, n in ((1, "body"), (2, "border"), (3, "pallu"))}
    out["uncovered_inside_drape"] = int(((sil > 0) & (labels == 0)).sum())
    return out
