import { useEffect, useState } from 'react';
import { adminFetch } from './api.js';
import { BarChart, LineChart, Legend } from './charts.jsx';

const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
const DAILY = [['generations', '#8b7bff', 'Outputs'], ['uploads', '#34d3b6', 'Uploads'], ['activeUsers', '#f5b84b', 'Active users']];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// How often the platform is used: daily trend, hour-of-day and weekday
// frequency, and the most active users, over a selectable range.
export default function UsageAnalytics() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setErr('');
    adminFetch(`/usage?days=${days}`).then((r) => live && setD(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [days]);

  const t = d?.totals;
  return (
    <section className="ad-glass ad-panel ad-usage">
      <div className="ad-panel-h wrap">
        <h2>Usage frequency</h2>
        <div className="ad-seg" role="group" aria-label="Time range">
          {RANGES.map(([v, l]) => (
            <button key={v} className={days === v ? 'on' : ''} aria-pressed={days === v} onClick={() => setDays(v)}>{l}</button>
          ))}
        </div>
      </div>
      {err && <div className="ad-error">{err}</div>}
      {!d ? <div className="ad-muted">Loading usage…</div> : (
        <>
          <div className="ad-cards compact">
            <div className="ad-card"><div className="ad-muted small">Outputs generated</div><div className="ad-num">{t.generations}</div></div>
            <div className="ad-card"><div className="ad-muted small">Images uploaded</div><div className="ad-num">{t.uploads}</div></div>
            <div className="ad-card"><div className="ad-muted small">Active users</div><div className="ad-num">{t.activeUsers}</div></div>
            <div className="ad-card"><div className="ad-muted small">Outputs / active user</div>
              <div className="ad-num">{t.activeUsers ? (t.generations / t.activeUsers).toFixed(1) : '0'}</div></div>
          </div>

          <div className="ad-panel-h"><h3>Daily activity</h3><Legend series={DAILY} /></div>
          <LineChart data={d.daily} series={DAILY} label={`Daily activity, last ${days} days`} />

          <div className="ad-grid2">
            <div>
              <h3>By hour of day <small className="ad-muted">({d.timezone})</small></h3>
              <BarChart data={d.hourly.map((h) => ({ ...h, label: String(h.hour), tip: `${h.hour}:00 – ${h.hour}:59` }))}
                series={[['generations', '#8b7bff', 'Outputs']]} every={3} height={190}
                label="Outputs by hour of day" />
            </div>
            <div>
              <h3>By weekday</h3>
              <BarChart data={d.weekday.map((w) => ({ ...w, label: WEEK[w.day] }))}
                series={[['generations', '#34d3b6', 'Outputs']]} height={190} label="Outputs by weekday" />
            </div>
          </div>

          <h3>Most active users</h3>
          {d.topUsers.length ? (
            <BarChart
              data={d.topUsers.map((u) => ({ ...u, label: (u.name || u.email).split(/[\s@]/)[0].slice(0, 10), tip: u.email }))}
              series={[['generations', '#8b7bff', 'Outputs'], ['uploads', '#34d3b6', 'Uploads'], ['activeDays', '#f5b84b', 'Active days']]}
              height={210} label="Per-user usage frequency" />
          ) : <div className="ad-muted small">No activity in this range.</div>}
        </>
      )}
    </section>
  );
}
