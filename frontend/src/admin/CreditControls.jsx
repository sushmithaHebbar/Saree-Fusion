import { useState } from 'react';
import { adminFetch } from './api.js';

// "X / 15 outputs used today" meter (compact for table rows).
export function UsageMeter({ usage, compact = false }) {
  if (!usage) return <span className="ad-muted small">—</span>;
  const pct = Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  const tone = usage.paused ? 'paused' : usage.used >= usage.limit ? 'full' : pct >= 80 ? 'warn' : 'ok';
  return (
    <span className={`ad-meter ${tone} ${compact ? 'compact' : ''}`}
      title={`${usage.used} of ${usage.limit} outputs used today${usage.paused ? ' · paused' : ''}`}>
      <span className="ad-meter-bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="ad-meter-txt">
        {usage.paused ? 'Paused' : `${usage.used} / ${usage.limit}`}
        {!compact && !usage.paused && <small className="ad-muted"> outputs today</small>}
      </span>
    </span>
  );
}

// Admin credit controls: pause until tomorrow, resume, reset today's counter,
// grant extra credits for today, change the standing daily limit.
export default function CreditControls({ user, usage, onChange }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [limit, setLimit] = useState(String(usage?.baseLimit ?? 15));

  const act = async (action, amount, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action); setErr('');
    try {
      const next = await adminFetch(`/users/${user.id}/credits`, {
        method: 'POST', body: JSON.stringify(amount === undefined ? { action } : { action, amount }),
      });
      onChange?.(next);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  if (!usage) return null;
  const resetTime = new Date(usage.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="ad-credits">
      <div className="ad-credits-top">
        <UsageMeter usage={usage} />
        <div className="ad-muted small">
          {usage.paused
            ? `Paused until ${new Date(usage.pausedUntil).toLocaleString()}`
            : usage.blocked ? `Limit reached · resets ${resetTime}` : `${usage.remaining} left · resets ${resetTime}`}
          {usage.bonus > 0 && ` · includes +${usage.bonus} today`}
        </div>
        <div className="ad-muted small">Uploads: {usage.uploadsToday} today · {usage.uploadsTotal} total · {usage.generatedTotal} outputs all-time</div>
      </div>
      <div className="ad-credits-actions">
        {usage.paused ? (
          <button className="ad-btn" disabled={!!busy} onClick={() => act('resume')}>Resume</button>
        ) : (
          <button className="ad-btn danger" disabled={!!busy}
            onClick={() => act('pause', undefined, `Stop ${user.email} from generating until tomorrow?`)}>Stop until tomorrow</button>
        )}
        <button className="ad-btn" disabled={!!busy} onClick={() => act('reset')}>Reset to 0 / {usage.baseLimit}</button>
        <button className="ad-btn primary" disabled={!!busy} onClick={() => act('add', usage.baseLimit || 15)}>+{usage.baseLimit || 15} credits today</button>
        <form className="ad-inline" onSubmit={(e) => { e.preventDefault(); const n = parseInt(limit, 10); if (n >= 0 && n <= 1000) act('limit', n); }}>
          <label className="sr-only" htmlFor={`lim-${user.id}`}>Daily limit</label>
          <input id={`lim-${user.id}`} type="number" min="0" max="1000" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <button className="ad-btn" disabled={!!busy}>Set daily limit</button>
        </form>
      </div>
      {err && <div className="ad-error">{err}</div>}
    </div>
  );
}
