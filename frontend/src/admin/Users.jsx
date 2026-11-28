import { useEffect, useMemo, useState } from 'react';
import { adminFetch } from './api.js';
import Inspector from './Inspector.jsx';
import { UsageMeter } from './CreditControls.jsx';

export default function Users() {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [busyId, setBusyId] = useState('');

  const load = () => adminFetch('/users').then((d) => setUsers(d.users)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => (users || []).filter((u) => `${u.email} ${u.name || ''}`.toLowerCase().includes(q.toLowerCase())), [users, q]);

  const toggle = async (u) => {
    const next = u.status === 'suspended' ? 'active' : 'suspended';
    if (next === 'suspended' && !window.confirm(`Suspend ${u.email}? They will be signed out of the weaver app.`)) return;
    setBusyId(u.id);
    try { await adminFetch(`/users/${u.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await load(); }
    catch (e) { setErr(e.message); } finally { setBusyId(''); }
  };

  const when = (v) => (v ? new Date(v).toLocaleDateString() : '—');
  // Keep the table in sync when credits change inside the Inspector
  const onUsage = (id, usage) => setUsers((us) => us.map((x) => (x.id === id ? { ...x, usage } : x)));

  return (
    <>
      <h1 className="ad-h1">Users & Inspector</h1>
      <input className="ad-search" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <div className="ad-error">{err}</div>}
      {!users ? <div className="ad-muted">Loading users…</div> : (
        <div className="ad-table">
          <div className="ad-tr head"><span>User</span><span>Status</span><span>Today</span><span>Uploads</span><span>Batches</span><span>Last login</span><span /></div>
          {rows.map((u) => (
            <div className="ad-tr" key={u.id}>
              <span data-l="User" className="ad-user">
                {u.pictureUrl ? <img src={u.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <i>{(u.name || u.email)[0].toUpperCase()}</i>}
                <b>{u.name || '—'}<small>{u.email}</small></b>
              </span>
              <span data-l="Status"><em className={`ad-pill ${u.status}`}>{u.status}</em></span>
              <span data-l="Today"><UsageMeter usage={u.usage} compact /></span>
              <span data-l="Uploads" title="Images uploaded today / all time">{u.usage ? `${u.usage.uploadsToday} / ${u.usage.uploadsTotal}` : '—'}</span>
              <span data-l="Batches">{u.batches}</span>
              <span data-l="Last login">{when(u.lastLoginAt)}</span>
              <span className="ad-actions">
                <button className="ad-btn" onClick={() => setSel(u)}>Inspect &amp; credits</button>
                <button className={`ad-btn ${u.status === 'suspended' ? '' : 'danger'}`} disabled={busyId === u.id} onClick={() => toggle(u)}>
                  {u.status === 'suspended' ? 'Restore' : 'Suspend'}
                </button>
              </span>
            </div>
          ))}
          {!rows.length && <div className="ad-muted ad-pad">No users match.</div>}
        </div>
      )}
      {sel && <Inspector user={sel} onClose={() => setSel(null)} onUsage={onUsage} />}
    </>
  );
}
