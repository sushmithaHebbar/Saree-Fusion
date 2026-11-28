import { useEffect, useMemo, useState } from 'react';
import { adminFetch } from './api.js';
import GenerationGallery from './GenerationGallery.jsx';
import CreditControls from './CreditControls.jsx';

export default function Inspector({ user, onClose, onUsage }) {
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('gallery');
  const [usage, setUsage] = useState(user.usage);

  // Daily roll-up of this user's batches (newest first)
  const daily = useMemo(() => {
    const m = new Map();
    for (const b of [...(rec?.batches || [])].sort((a, c) => c._createdAt.localeCompare(a._createdAt))) {
      const day = new Date(b._createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const r = m.get(day) || { day, batches: 0, uploaded: 0, generated: 0 };
      r.batches += 1; r.uploaded += b.uploaded || 0; r.generated += b.generated || 0;
      m.set(day, r);
    }
    return [...m.values()];
  }, [rec]);
  const total = daily.reduce((t, r) => ({ batches: t.batches + r.batches, uploaded: t.uploaded + r.uploaded, generated: t.generated + r.generated }), { batches: 0, uploaded: 0, generated: 0 });

  useEffect(() => {
    adminFetch(`/users/${user.id}/records`).then(setRec).catch((e) => setErr(e.message));
  }, [user.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.ad-modal .ad-modal') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ad-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ad-glass ad-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ad-panel-h"><h2>{user.name || user.email}<small className="ad-muted"> · {user.email}</small></h2>
          <button className="ad-btn" onClick={onClose}>Close</button></div>
        {err && <div className="ad-error">{err}</div>}

        <CreditControls user={user} usage={usage} onChange={(u) => { setUsage(u); onUsage?.(user.id, u); }} />

        <div className="ad-tabs ad-view">
          <button className={view === 'gallery' ? 'on' : ''} onClick={() => setView('gallery')}>Inputs &amp; outputs</button>
          <button className={view === 'daily' ? 'on' : ''} onClick={() => setView('daily')}>Daily summary</button>
        </div>

        <div style={{ marginTop: '.8rem' }}>
          {view === 'gallery' && <GenerationGallery userId={user.id} pageSize={12} />}
          {view === 'daily' && (!rec ? <div className="ad-muted">Loading…</div> : (
            <div className="ad-table">
              <div className="ad-tr head ad-tr4"><span>Date</span><span>Batches</span><span>Images uploaded</span><span>Images generated</span></div>
              {daily.map((r) => (
                <div className="ad-tr ad-tr4" key={r.day}>
                  <span data-l="Date">{r.day}</span><span data-l="Batches">{r.batches}</span>
                  <span data-l="Uploaded">{r.uploaded}</span><span data-l="Generated">{r.generated}</span>
                </div>))}
              <div className="ad-tr ad-tr4"><b>Total</b><b>{total.batches}</b><b>{total.uploaded}</b><b>{total.generated}</b></div>
              {!daily.length && <div className="ad-muted ad-pad">No activity yet.</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
