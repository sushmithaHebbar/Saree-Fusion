// Dominant ground (base) colour of a motif image.
// The ground is what surrounds the motif, so the image's outer ring of pixels
// is sampled first; if it is mostly transparent, the whole image is used.
// Colours are bucketed (4 bits/channel) and the most common bucket's average
// is returned as #rrggbb. Returns null when the image cannot be read.
export function dominantGround(img) {
  try {
    const N = 64;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);

    const tally = (pred) => {
      const buckets = new Map();
      let n = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (!pred(x, y)) continue;
          const i = (y * N + x) * 4;
          if (data[i + 3] < 128) continue;            // skip transparent
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const e = buckets.get(key) || [0, 0, 0, 0];
          e[0] += r; e[1] += g; e[2] += b; e[3] += 1;
          buckets.set(key, e);
          n++;
        }
      }
      return { buckets, n };
    };

    const ring = 4;
    let { buckets, n } = tally((x, y) => x < ring || y < ring || x >= N - ring || y >= N - ring);
    if (n < 40) ({ buckets, n } = tally(() => true));
    if (!n) return null;
    let best = null;
    for (const e of buckets.values()) if (!best || e[3] > best[3]) best = e;
    const hex = (v) => Math.round(v / best[3]).toString(16).padStart(2, '0');
    return `#${hex(best[0])}${hex(best[1])}${hex(best[2])}`;
  } catch {
    return null; // e.g. a cross-origin image without CORS
  }
}
