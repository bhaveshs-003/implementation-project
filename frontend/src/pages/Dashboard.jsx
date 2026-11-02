import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { PageLoader, useDelayedLoading } from '../components/Spinner.jsx';

/* Blue / orange are validated categorical slots; brown, gray and red are distinct by lightness and carry labels. */
const COLOR = {
  blue: '#2a78d6', orange: '#eb6834', brown: '#7a3b12', gray: '#d3d4dc',
  notStarted: '#e1e0d9', inProgress: '#bcc9f5', overridden: '#7c8be8', awaiting: '#9ca0ad', red: '#d03b3b',
};

const RANGES = [
  { id: 'all', label: 'All time' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'month', label: 'This month' },
];
const RANGE_LABEL = { all: 'All time', quarter: 'This quarter', month: 'This month' };

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ── Donut (SVG) ── */
function Donut({ segments, centerValue, centerLabel, label }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 48;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" width="150" height="150">
        <circle cx="60" cy="60" r={R} fill="none" stroke={COLOR.gray} strokeWidth="14" />
        {total > 0 && segments.filter(s => s.value > 0).map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.name} cx="60" cy="60" r={R} fill="none" stroke={s.color} strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="donut-center">
        <div className="donut-value">{centerValue}</div>
        <div className="donut-label">{centerLabel}</div>
      </div>
    </div>
  );
}

function LegendRow({ color, name, value, to, navigate }) {
  const inner = (
    <>
      <span className="row" style={{ gap: 10 }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
        {name}
      </span>
      <span className="fw-600">{value}</span>
    </>
  );
  if (!to) return <div className="legend-row">{inner}</div>;
  return <button type="button" className="legend-row legend-link" onClick={() => navigate(to)}>{inner}</button>;
}

/* ── On-time delivery ── */
function OnTimeCard({ data, isAdmin, navigate }) {
  const d = data.delivery;
  const delayed = isAdmin ? d.company_delay + d.partner_delay : d.delayed;
  const completed = d.on_time + delayed;

  let note;
  if (completed === 0) note = 'No milestones were completed in this period.';
  else if (delayed === 0) note = 'No delays recorded in this period.';
  else if (!isAdmin) note = `${plural(delayed, 'delay')} recorded across your projects.`;
  else if (d.company_delay === 0) note = `All ${delayed} delays are partner-side. No company-side delay recorded to date.`;
  else if (d.partner_delay === 0) note = `All ${delayed} delays are company-side. No partner-side delay recorded to date.`;
  else note = `${plural(d.company_delay, 'delay')} company-side and ${d.partner_delay} partner-side.`;

  const segments = isAdmin
    ? [
        { name: 'Completed on time', value: d.on_time, color: COLOR.blue },
        { name: 'Delayed · partner side', value: d.partner_delay, color: COLOR.orange },
        { name: 'Delayed · company side', value: d.company_delay, color: COLOR.brown },
      ]
    : [
        { name: 'Completed on time', value: d.on_time, color: COLOR.blue },
        { name: 'Delayed', value: d.delayed, color: COLOR.orange },
      ];

  return (
    <div className="card dash-card">
      <h2 className="dash-card-title">On-time delivery</h2>
      <p className="dash-card-sub">
        {plural(completed, 'completed milestone')}{isAdmin ? ', by who owned the delay' : ''}
      </p>
      <div className="dash-ontime">
        <Donut
          segments={segments}
          centerValue={completed > 0 ? `${pct(d.on_time, completed)}%` : '—'}
          centerLabel="on time"
          label={`${pct(d.on_time, completed)}% of completed milestones were on time`}
        />
        <div className="legend">
          {segments.map((s) => (
            <LegendRow
              key={s.name} color={s.color} name={s.name} value={s.value} navigate={navigate}
              to={s.name === 'Completed on time' ? '/projects?milestone=on_time'
                : s.name.includes('partner') ? '/projects?milestone=partner_delay'
                : s.name.includes('company') ? '/projects?milestone=company_delay' : undefined}
            />
          ))}
        </div>
      </div>
      <div className="dash-note"><Icon name="info" size={16} /><span>{note}</span></div>
    </div>
  );
}

/* ── Project pipeline ── */
function PipelineCard({ data, navigate }) {
  const p = data.pipeline;
  const total = data.totals.projects;
  const perProject = total <= 40;
  const blocks = [
    { name: 'Not started', n: p.not_started, color: COLOR.notStarted },
    { name: 'In progress', n: p.in_progress, color: COLOR.inProgress },
    { name: 'Completed', n: p.completed, color: COLOR.blue },
  ];
  const segs = perProject
    ? blocks.flatMap((b) => Array.from({ length: b.n }, (_, i) => ({ key: `${b.name}-${i}`, color: b.color, grow: 1, name: b.name })))
    : blocks.filter(b => b.n > 0).map((b) => ({ key: b.name, color: b.color, grow: b.n, name: b.name }));

  return (
    <div className="card dash-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="dash-card-title">Project pipeline</h2>
          <p className="dash-card-sub">Where each of the {total} projects sits today</p>
        </div>
        <button type="button" className="link-btn" onClick={() => navigate('/projects')}>View all projects</button>
      </div>
      <div className="pipe-strip" role="img" aria-label={`${p.not_started} not started, ${p.in_progress} in progress, ${p.completed} completed`}>
        {segs.map((s) => <span key={s.key} title={s.name} style={{ flexGrow: s.grow, background: s.color }} />)}
      </div>
      <div className="pipe-minis">
        <button type="button" className="pipe-mini" onClick={() => navigate('/projects?status=not_started')}>
          <span className="pipe-mini-title"><span className="dot dot-hollow" />Not started</span>
          <span className="pipe-mini-value" style={{ color: p.not_started === 0 ? 'var(--text-3)' : undefined }}>{p.not_started}</span>
          <span className="pipe-mini-sub">{p.not_started === 0 ? 'Nothing queued' : `${pct(p.not_started, total)}% of portfolio`}</span>
        </button>
        <button type="button" className="pipe-mini" onClick={() => navigate('/projects?status=in_progress')}>
          <span className="pipe-mini-title"><span className="dot" style={{ background: COLOR.inProgress }} />In progress</span>
          <span className="pipe-mini-value">{p.in_progress}</span>
          <span className="pipe-mini-sub">{pct(p.in_progress, total)}% of portfolio</span>
        </button>
        <div className="pipe-mini" style={{ cursor: 'default' }}>
          <button type="button" className="pipe-mini-title pipe-plain" onClick={() => navigate('/projects?status=completed')}>
            <span className="dot" style={{ background: COLOR.blue }} />Completed
          </button>
          <span className="pipe-mini-value">{p.completed}</span>
          <span className="row wrap" style={{ gap: 6 }}>
            <button type="button" className="chip chip-good" onClick={() => navigate('/projects?outcome=on_time')}>
              <Icon name="check" size={12} /> {p.completed_on_time} on time
            </button>
            <button type="button" className="chip" onClick={() => navigate('/projects?outcome=delayed')}>
              {p.completed_delayed} delayed
            </button>
          </span>
        </div>
      </div>
      {p.completed_unclassified > 0 && (
        <p className="text-xs subtle" style={{ marginTop: 10 }}>
          {plural(p.completed_unclassified, 'completed project')} not classified (no approved end date or milestones).
        </p>
      )}
    </div>
  );
}

/* ── Milestone status ── */
function MilestoneStatusCard({ data, isAdmin, navigate }) {
  const d = data.delivery;
  const rows = isAdmin
    ? [
        { name: 'Completed on time', n: d.on_time, color: COLOR.blue, to: '/projects?milestone=on_time' },
        { name: 'Delayed · partner side', n: d.partner_delay, color: COLOR.orange, to: '/projects?milestone=partner_delay' },
        { name: 'Delayed · company side', n: d.company_delay, color: COLOR.brown, to: '/projects?milestone=company_delay' },
        { name: 'Not yet completed', n: d.not_completed, color: COLOR.gray },
      ]
    : [
        { name: 'Completed on time', n: d.on_time, color: COLOR.blue, to: '/projects?milestone=on_time' },
        { name: 'Delayed', n: d.delayed, color: COLOR.orange },
        { name: 'Not yet completed', n: d.not_completed, color: COLOR.gray },
      ];
  const total = rows.reduce((s, r) => s + r.n, 0);

  return (
    <div className="card dash-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="dash-card-title">Milestone status</h2>
          <p className="dash-card-sub">Including extended milestones</p>
        </div>
        <div><span className="dash-big">{total}</span> <span className="text-sm subtle">total</span></div>
      </div>
      <div className="pipe-strip" style={{ height: 12 }} role="img" aria-label="Milestones by status">
        {rows.filter(r => r.n > 0).map((r) => <span key={r.name} title={`${r.name}: ${r.n}`} style={{ flexGrow: r.n, background: r.color }} />)}
      </div>
      <table className="dash-table">
        <thead><tr><th>Status</th><th className="num">Milestones</th><th className="num">Share</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={r.to ? 'clickable' : undefined} onClick={r.to ? () => navigate(r.to) : undefined}>
              <td><span className="row" style={{ gap: 10 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: r.color, display: 'inline-block' }} />{r.name}</span></td>
              <td className="num fw-600">{r.n}</td>
              <td className="num muted">{pct(r.n, total)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Approvals ── */
function ApprovalsCard({ data, isAdmin, navigate }) {
  const a = data.approvals;
  const rows = isAdmin
    ? [
        { name: 'Approved by Partner POC', n: a.partner_approved, color: COLOR.blue, to: '/projects?approval=approved' },
        { name: 'Approved by admin override', n: a.overridden, color: COLOR.overridden, to: '/projects?approval=overridden' },
        { name: 'Awaiting partner', n: a.awaiting, color: COLOR.awaiting, to: '/projects?approval=pending' },
        { name: 'Declined', n: a.declined, color: COLOR.red, to: '/projects?approval=declined', danger: true },
      ]
    : [
        { name: 'Approved', n: a.approved, color: COLOR.blue, to: '/projects?approval=approved' },
        { name: 'Awaiting my approval', n: a.awaiting, color: COLOR.awaiting, to: '/projects?approval=pending' },
        { name: 'Declined', n: a.declined, color: COLOR.red, to: '/projects?approval=declined', danger: true },
      ];
  const total = rows.reduce((s, r) => s + r.n, 0);
  const approved = isAdmin ? a.partner_approved + a.overridden : a.approved;

  return (
    <div className="card dash-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="dash-card-title">Approvals</h2>
          <p className="dash-card-sub">Current state, each milestone counted once</p>
        </div>
        <div><span className="dash-big">{approved}</span> <span className="text-sm subtle">of {total} approved</span></div>
      </div>
      {total === 0 ? (
        <p className="text-sm subtle">No milestones have been submitted for approval in this period.</p>
      ) : (
        <div className="appr-list">
          {rows.map((r) => (
            <button key={r.name} type="button" className="appr-row" onClick={() => navigate(r.to)}>
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <span>{r.name}</span>
                <span className="fw-600" style={{ color: r.danger && r.n > 0 ? COLOR.red : undefined }}>{r.n}</span>
              </span>
              <span className="appr-track">
                {r.n > 0 && <span style={{ width: `${Math.max(3, pct(r.n, total))}%`, background: r.color }} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Needs attention ── */
const STATE_META = {
  declined: { label: 'Declined', cls: 'badge-danger', icon: 'x', action: 'Review' },
  awaiting: { label: 'Awaiting partner', cls: '', icon: 'clock', action: 'Open' },
  override: { label: 'Approved by override', cls: 'badge-info', icon: 'check', action: 'View note' },
};

function AttentionCard({ data, isAdmin, navigate }) {
  const { total, rows } = data.attention;
  return (
    <div className="card dash-card" style={{ padding: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', padding: '18px 22px' }}>
        <div className="row" style={{ gap: 10 }}>
          <h2 className="dash-card-title" style={{ margin: 0 }}>{isAdmin ? 'Needs attention' : 'Needs your action'}</h2>
          {total > 0 && <span className="count-pill">{total}</span>}
        </div>
        <button type="button" className="link-btn" onClick={() => navigate('/projects?approval=pending')}>Open approvals queue</button>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm subtle" style={{ padding: '4px 22px 20px' }}>Nothing needs attention right now.</div>
      ) : (
        <div className="table-wrap">
          <table className="dash-table dash-table-wide">
            <thead>
              <tr>
                <th>Milestone</th><th>Project</th><th>Status</th>{isAdmin && <th>Owner</th>}<th className="num">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = STATE_META[isAdmin ? r.state : 'awaiting'];
                const label = isAdmin ? meta.label : 'Awaiting your approval';
                return (
                  <tr key={`${r.milestone_id}-${r.state}`}>
                    <td className="fw-600">{r.milestone_title}</td>
                    <td className="muted">{r.project_title}</td>
                    <td><span className={`badge ${meta.cls}`}><Icon name={meta.icon} size={12} /> {label}</span></td>
                    {isAdmin && <td className="muted">{r.owner || '—'}</td>}
                    <td className="num">
                      <button
                        type="button" className="btn btn-secondary btn-sm"
                        title={r.note ? `Override note: ${r.note}` : undefined}
                        onClick={() => navigate(`/projects/${r.project_id}`)}
                      >
                        {isAdmin ? meta.action : 'Review'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── CSV export of what is on screen ── */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportReport(data, isAdmin, partnerName) {
  const d = data.delivery;
  const a = data.approvals;
  const p = data.pipeline;
  const lines = [
    ['Delivery overview'],
    ['Range', RANGE_LABEL[data.range]],
    ['Partner', partnerName || 'All partners'],
    ['Generated', data.generated_at],
    [],
    ['Metric', 'Value'],
    ['Projects', data.totals.projects],
    ['Milestones', data.totals.milestones],
    ['Projects not started', p.not_started],
    ['Projects in progress', p.in_progress],
    ['Projects completed', p.completed],
    ['Projects completed on time', p.completed_on_time],
    ['Projects completed with delay', p.completed_delayed],
    ['Milestones completed on time', d.on_time],
    ...(isAdmin
      ? [['Milestones delayed: partner side', d.partner_delay], ['Milestones delayed: company side', d.company_delay]]
      : [['Milestones delayed', d.delayed]]),
    ['Milestones not yet completed', d.not_completed],
    ...(isAdmin
      ? [['Approved by Partner POC', a.partner_approved], ['Approved by admin override', a.overridden], ['Awaiting partner', a.awaiting], ['Declined', a.declined]]
      : [['Approved', a.approved], ['Awaiting my approval', a.awaiting], ['Declined', a.declined]]),
    [],
    ['Needs attention'],
    isAdmin ? ['Milestone', 'Project', 'Status', 'Owner'] : ['Milestone', 'Project', 'Status'],
    ...data.attention.rows.map((r) => (isAdmin
      ? [r.milestone_title, r.project_title, STATE_META[r.state].label, r.owner]
      : [r.milestone_title, r.project_title, 'Awaiting your approval'])),
  ];
  const csv = lines.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `delivery-overview-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const { person } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = person?.role === 'admin';

  const range = RANGES.some(r => r.id === searchParams.get('range')) ? searchParams.get('range') : 'all';
  const partner = isAdmin ? searchParams.get('partner') || '' : '';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setRefreshing(true);
    const qs = new URLSearchParams();
    if (range !== 'all') qs.set('range', range);
    if (partner) qs.set('partner', partner);
    apiFetch(`/api/dashboard${qs.toString() ? `?${qs}` : ''}`)
      .then((d) => { setData(d); setError(''); })
      .catch(() => setError('Failed to load dashboard data. Please refresh and try again.'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [range, partner]);

  useEffect(() => { load(); }, [load]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const showLoader = useDelayedLoading(loading);
  if (loading) return showLoader ? <PageLoader message="Loading dashboard…" /> : null;
  if (error && !data) return <div className="alert alert-error"><Icon name="alert" />{error}</div>;
  if (!data?.totals) {
    return (
      <div className="alert alert-error">
        <Icon name="alert" />
        The dashboard data is in an unexpected format. The server may still be updating; please refresh in a few minutes.
      </div>
    );
  }

  const partnerName = data.partners?.find((x) => x.id === partner)?.name;
  const updated = new Date(data.generated_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className={refreshing ? 'dash-refreshing' : undefined}>
      <div className="dash-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Delivery overview</h1>
          <p className="page-subtitle">
            Portfolio health across {plural(data.totals.projects, 'project')} and {plural(data.totals.milestones, 'milestone')} · Updated {updated}
          </p>
        </div>
        <div className="dash-controls">
          <div className="seg" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" className={range === r.id ? 'on' : ''} aria-pressed={range === r.id} onClick={() => setParam('range', r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <select className="select" style={{ width: 'auto' }} value={partner} onChange={(e) => setParam('partner', e.target.value)} aria-label="Partner">
              <option value="">All partners</option>
              {(data.partners || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-primary" onClick={() => exportReport(data, isAdmin, partnerName)}>
            <Icon name="download" size={16} /> Export report
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}

      {data.totals.projects === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon"><Icon name="folder" /></div>
            <div className="empty-title">{isAdmin ? (partner ? 'No projects for this partner' : 'No projects yet') : 'No projects assigned to you yet'}</div>
            <div className="empty-text">
              {isAdmin ? 'Create a project, or choose All partners, to see delivery figures.' : 'Projects will appear here once an admin assigns you as the Partner POC.'}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="dash-row dash-row-1">
            <OnTimeCard data={data} isAdmin={isAdmin} navigate={navigate} />
            <PipelineCard data={data} navigate={navigate} />
          </div>
          <div className="dash-row dash-row-2">
            <MilestoneStatusCard data={data} isAdmin={isAdmin} navigate={navigate} />
            <ApprovalsCard data={data} isAdmin={isAdmin} navigate={navigate} />
          </div>
          <AttentionCard data={data} isAdmin={isAdmin} navigate={navigate} />
        </>
      )}
    </div>
  );
}
