import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config.js';
import { adminFetch } from './api.js';

const abs = (u) => (u?.startsWith('/api/') ? `${API_BASE_URL}${u}` : u);
const SLOTS = [['border', 'Border'], ['body', 'Body motif'], ['pallu', 'Pallu']];

function Img({ src, alt, onOpen, className = '' }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <span className={`ad-img missing ${className}`}>No image</span>;
  return (
    <button type="button" className={`ad-img ${className}`} onClick={onOpen} title={alt}>
      <img src={abs(src)} alt={alt} loading="lazy" onError={() => setBad(true)} />
    </button>
  );
}

// Full-size viewer: inputs on the left, outputs on the right (stacked on phones)
function Viewer({ item, onClose }) {
  const [zoom, setZoom] = useState(null);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && (zoom ? setZoom(null) : onClose());
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, zoom]);
  const out = item.outputs[0] || {};
  return (
    <div className="ad-modal" role="dialog" aria-modal="true" aria-label={`Generation ${item.id}`} onClick={onClose}>
      <div className="ad-glass ad-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ad-panel-h">
          <h2>{item.id}<small className="ad-muted"> · {item.user?.email || 'unowned'} · {new Date(item.createdAt).toLocaleString()}</small></h2>
          <button className="ad-btn" onClick={onClose}>Close</button>
        </div>
        <div className="ad-io">
          <section>
            <h3>Inputs</h3>
            <div className="ad-io-inputs">
              {SLOTS.map(([k, l]) => (item.inputs[k] || []).map((c, i) => (
                <figure key={k + i}>
                  <Img src={c.image} alt={`${l} ${c.label}`} onOpen={() => setZoom(c.image)} className="big" />
                  <figcaption>{l} <span className="ad-muted">{c.label}</span></figcaption>
                </figure>
              )))}
            </div>
            <dl className="ad-params">
              <dt>Style</dt><dd>{item.style || '—'}</dd>
              <dt>Engine</dt><dd>{item.engine || '—'}</dd>
              <dt>Description</dt><dd>{item.description || <span className="ad-muted">None</span>}</dd>
            </dl>
          </section>
          <section>
            <h3>Outputs</h3>
            <figure>
              <Img src={out.wearable} alt="Wearable drape" onOpen={() => setZoom(out.wearable)} className="tall" />
              <figcaption>Wearable drape</figcaption>
            </figure>
            <figure>
              <Img src={out.template} alt="Flat template" onOpen={() => setZoom(out.template)} className="wide" />
              <figcaption>Flat template</figcaption>
            </figure>
          </section>
        </div>
      </div>
      {zoom && (
        <div className="ad-zoom" onClick={(e) => { e.stopPropagation(); setZoom(null); }}>
          <img src={abs(zoom)} alt="" />
        </div>
      )}
    </div>
  );
}

function Card({ item, onOpen, showUser }) {
  const out = item.outputs[0] || {};
  return (
    <article className="ad-gcard ad-glass">
      <button type="button" className="ad-gcard-hit" onClick={onOpen} aria-label={`Inspect ${item.id}`} />
      <div className="ad-gcard-imgs">
        <div className="ad-gcard-in">
          {SLOTS.map(([k, l]) => (
            <span key={k} className="ad-chip-img" title={l}>
              {item.inputs[k]?.[0]?.image ? <img src={abs(item.inputs[k][0].image)} alt={l} loading="lazy" /> : null}
              <small>{l.split(' ')[0]}</small>
            </span>
          ))}
        </div>
        <span className="ad-arrow" aria-hidden>→</span>
        <div className="ad-gcard-out">
          {out.wearable && <img src={abs(out.wearable)} alt="Wearable" loading="lazy" />}
        </div>
      </div>
      <div className="ad-gcard-meta">
        {showUser && <b>{item.user?.name || item.user?.email || 'unowned'}</b>}
        <small className="ad-muted">{new Date(item.createdAt).toLocaleString()} · {item.style || 'normal'}</small>
      </div>
    </article>
  );
}

/** Visual input → output gallery. Pass userId to restrict to one user. */
export default function GenerationGallery({ userId, pageSize = 18 }) {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async (before) => {
    const q = new URLSearchParams({ limit: String(pageSize) });
    if (userId) q.set('user', userId);
    if (before) q.set('before', before);
    try {
      const { items: page } = await adminFetch(`/generations?${q}`);
      setItems((prev) => (before ? [...(prev || []), ...page] : page));
      setMore(page.length === pageSize);
    } catch (e) { setErr(e.message); }
  }, [userId, pageSize]);

  useEffect(() => { setItems(null); load(); }, [load]);

  if (err) return <div className="ad-error">{err}</div>;
  if (!items) return <div className="ad-muted">Loading generations…</div>;
  if (!items.length) return <div className="ad-muted ad-pad">No generations yet.</div>;
  return (
    <>
      <div className="ad-gallery">
        {items.map((it) => <Card key={it.id} item={it} showUser={!userId} onOpen={() => setOpen(it)} />)}
      </div>
      {more && (
        <button className="ad-btn ad-more" onClick={() => load(items[items.length - 1].createdAt)}>Load more</button>
      )}
      {open && <Viewer item={open} onClose={() => setOpen(null)} />}
    </>
  );
}
