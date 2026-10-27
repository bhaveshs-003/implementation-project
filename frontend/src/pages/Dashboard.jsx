import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import ProgressBar from '../components/ProgressBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Icon from '../components/Icon.jsx';
import { PageLoader, useDelayedLoading } from '../components/Spinner.jsx';
import { fmtDate } from '../lib/format.js';

/* Validated categorical slots 1-3 (blue, orange) + muted gray for "other"; critical is the reserved status red. */
const C = { blue: '#2a78d6', orange: '#eb6834', gray: '#898781', critical: '#d03b3b' };
const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781' };
const GRID = { vertical: false, stroke: '#e1e0d9' };
const AXIS = { axisLine: false, tickLine: false, tick: { fill: INK.muted, fontSize: 12 } };
const TOOLTIP = {
  contentStyle: {
    background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)', fontSize: 13, padding: '8px 12px',
  },
  labelStyle: { color: INK.primary, fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { fill: '#f3f4f6' },
};

const TONES = {
  primary: { background: 'var(--primary-soft)', color: 'var(--primary)' },
  info: { background: 'var(--info-soft)', color: 'var(--info)' },
  success: { background: 'var(--success-soft)', color: 'var(--success)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function StatCard({ label, value, sub, icon, tone = 'primary' }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={TONES[tone]}><Icon name={icon} /></span>
      </div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="text-xs subtle" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, subtitle, children, flush = false, style }) {
  return (
    <div className="card" style={style}>
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      </div>
      {flush ? children : <div className="card-body">{children}</div>}
    </div>
  );
}

function NoData({ text = 'No data available yet.' }) {
  return (
    <div className="empty" style={{ padding: '32px 16px' }}>
      <div className="empty-icon"><Icon name="inbox" /></div>
      <div className="empty-text">{text}</div>
    </div>
  );
}

/* Horizontal bar chart: one mark per category, value labelled at the bar end, identity on the axis. */
function HBar({ data, valueFormat = (v) => v, label, tooltipExtra }) {
  const height = Math.max(150, data.length * 46 + 16);
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#e1e0d9" />
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="name" width={118} {...AXIS} tick={{ fill: INK.secondary, fontSize: 12 }} />
          <Tooltip
            {...TOOLTIP}
            formatter={(v, _n, item) => [valueFormat(v), tooltipExtra ? tooltipExtra(item.payload) : 'Value']}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d, i) => <Cell key={i} fill={d.fill || C.blue} />)}
            <LabelList dataKey="value" position="right" formatter={valueFormat} fill={INK.primary} fontSize={12} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Throughput: milestones completed per week ── */
function ThroughputTrend({ data }) {
  if (!data?.length) return <NoData text="No milestones completed in the last 8 weeks." />;
  const chartData = data.map((r) => ({
    week: new Date(r.week).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    completions: r.completions,
  }));
  return (
    <div role="img" aria-label="Milestones completed per week over the last eight weeks">
      <ResponsiveContainer width="100%" height={236}>
        <LineChart data={chartData} margin={{ top: 20, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="week" {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip {...TOOLTIP} cursor={{ stroke: '#c3c2b7', strokeWidth: 1 }} />
          <Line
            type="monotone" dataKey="completions" name="Milestones completed"
            stroke={C.blue} strokeWidth={2}
            dot={{ r: 4, fill: C.blue, stroke: '#fcfcfb', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: C.blue, stroke: '#fcfcfb', strokeWidth: 2 }}
          >
            <LabelList dataKey="completions" position="top" fill={INK.primary} fontSize={12} fontWeight={600} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Approval pipeline: where completed milestones sit in sign-off ── */
function ApprovalPipeline({ data }) {
  if (!data) return <NoData />;
  const rows = [
    { name: 'Not submitted', value: data.not_submitted, fill: C.blue },
    { name: 'Awaiting partner', value: data.awaiting_partner, fill: C.blue },
    { name: 'Denied', value: data.denied, fill: C.critical },
    { name: 'Approved', value: data.approved, fill: C.gray },
  ];
  if (rows.every((r) => r.value === 0)) return <NoData text="No completed milestones yet." />;
  return <HBar data={rows} label="Completed milestones by approval stage" tooltipExtra={() => 'Milestones'} />;
}

/* ── Who caused the delays ── */
function DelayCauses({ data }) {
  if (!data?.length) return <NoData text="No delayed milestones." />;
  const order = { company: 0, partner: 1, unattributed: 2 };
  const meta = {
    company: { name: 'Company side', fill: C.blue },
    partner: { name: 'Partner side', fill: C.orange },
    unattributed: { name: 'Unattributed', fill: C.gray },
  };
  const rows = [...data]
    .sort((a, b) => order[a.side] - order[b.side])
    .map((r) => ({ name: meta[r.side].name, value: r.count, fill: meta[r.side].fill }));
  return <HBar data={rows} label="Delayed milestones by responsible side" tooltipExtra={() => 'Delayed milestones'} />;
}

/* ── How late, by project type ── */
function LateByType({ data }) {
  if (!data?.length) return <NoData text="No delayed milestones with a due date." />;
  const rows = data.map((r) => ({ name: r.type, value: Math.round(r.avg_days_late * 10) / 10, count: r.delayed_milestones }));
  return (
    <HBar
      data={rows}
      valueFormat={(v) => `${v} d`}
      label="Average days late per project type"
      tooltipExtra={(p) => `Avg days late (${plural(p.count, 'delayed milestone')})`}
    />
  );
}

/* ── Schedule slippage: days beyond each project's approved end date ── */
function Slippage({ projects, navigate }) {
  if (!projects?.length) return <NoData text="No project is past its approved end date." />;
  const max = Math.max(...projects.map((p) => p.days_over));
  return (
    <div className="list">
      {projects.map((p) => (
        <div key={p.id} className="list-item clickable" onClick={() => navigate(`/projects/${p.id}`)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <div className="fw-600 truncate">
                <span className="mono text-sm muted">{p.code}</span>
                <span style={{ margin: '0 8px', color: 'var(--text-3)' }}>·</span>
                {p.title}
              </div>
              <span className="fw-600 text-sm" style={{ whiteSpace: 'nowrap' }}>{plural(p.days_over, 'day')} over</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#e1e0d9', margin: '8px 0 6px' }}>
              <div style={{ width: `${Math.max(4, (p.days_over / max) * 100)}%`, height: '100%', borderRadius: 4, background: C.blue }} />
            </div>
            <div className="text-xs subtle">
              {p.finished ? 'Finished late' : 'Still open'} · approved end {fmtDate(p.approved_end_date)}
            </div>
          </div>
          <Icon name="chevronRight" size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

/* ── Partner: next milestone deadlines ── */
function Upcoming({ items, navigate }) {
  if (!items?.length) return <NoData text="No open milestones with a due date." />;
  return (
    <div className="list">
      {items.map((m) => {
        const overdue = m.days_left < 0;
        const when = overdue ? `${plural(-m.days_left, 'day')} overdue`
          : m.days_left === 0 ? 'Due today' : `Due in ${plural(m.days_left, 'day')}`;
        return (
          <div key={m.id} className="list-item clickable" onClick={() => navigate(`/projects/${m.project_id}`)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fw-600 truncate">{m.title}</div>
              <div className="text-xs subtle">
                <span className="mono">{m.code}</span> · due {fmtDate(m.due_date)}
              </div>
            </div>
            <span className="row text-sm fw-600" style={{ gap: 6, color: overdue ? 'var(--danger)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>
              {overdue && <Icon name="alertTriangle" size={14} />}
              {when}
            </span>
            <Icon name="chevronRight" size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Project progress table ── */
function ProjectProgressTable({ projects, navigate }) {
  const [sortKey, setSortKey] = useState('title');
  const [sortDir, setSortDir] = useState('asc');
  if (!projects?.length) return <NoData text="No projects." />;

  const value = (p, key) => {
    if (key === 'progress') return p.total_milestones ? p.completed_milestones / p.total_milestones : 0;
    const v = p[key];
    return typeof v === 'string' ? v.toLowerCase() : v;
  };
  const sorted = [...projects].sort((a, b) => {
    const av = value(a, sortKey), bv = value(b, sortKey);
    if (av === bv) return 0;
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });
  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {[['code', 'Code'], ['title', 'Title'], ['type', 'Type'], ['status', 'Status'], ['progress', 'Milestones done']].map(([key, label]) => (
              <th key={key} className={`sortable${sortKey === key ? ' sorted' : ''}`} onClick={() => handleSort(key)}>
                <span className="row" style={{ gap: 4 }}>
                  {label}
                  <Icon
                    name={sortKey === key ? (sortDir === 'asc' ? 'arrowUp' : 'arrowDown') : 'chevronsUpDown'}
                    size={12}
                    style={{ opacity: sortKey === key ? 1 : 0.5 }}
                  />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
              <td className="mono muted">{p.code}</td>
              <td className="fw-600">{p.title}</td>
              <td className="muted">{p.type || '—'}</td>
              <td>{p.status ? <StatusBadge status={p.status} /> : '—'}</td>
              <td style={{ minWidth: 200 }}>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ flex: 1 }}><ProgressBar value={p.completed_milestones} max={p.total_milestones} showLabel /></div>
                  <span className="text-xs subtle" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {p.completed_milestones}/{p.total_milestones}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main Dashboard ── */
export default function Dashboard() {
  const { person } = useAuth();
  const navigate = useNavigate();
  const isAdmin = person?.role === 'admin';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/dashboard')
      .then(setData)
      .catch(() => setError('Failed to load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  const showLoader = useDelayedLoading(loading);
  if (loading) return showLoader ? <PageLoader message="Loading dashboard…" /> : null;
  if (error) return <div className="alert alert-error"><Icon name="alert" />{error}</div>;

  const k = data?.kpis || {};
  const projects = k.projects || {};
  const onTime = k.on_time || { on_time: 0, total: 0 };
  const onTimePct = onTime.total > 0 ? Math.round((onTime.on_time / onTime.total) * 100) : null;
  const onTimeTone = onTimePct === null ? 'info' : onTimePct >= 80 ? 'success' : onTimePct >= 60 ? 'warning' : 'danger';
  const projectsSub = [
    projects.not_started ? `${projects.not_started} not started` : null,
    projects.completed ? `${projects.completed} completed` : null,
  ].filter(Boolean).join(' · ') || `${projects.total || 0} in total`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {person?.name ? `Welcome back, ${person.name}. ` : ''}Here’s how your projects are tracking.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label={isAdmin ? 'Active projects' : 'Your projects in progress'}
          value={projects.in_progress ?? 0}
          sub={projectsSub}
          icon="activity" tone="primary"
        />
        <StatCard
          label="On-time delivery"
          value={onTimePct === null ? '—' : `${onTimePct}%`}
          sub={onTime.total ? `${onTime.on_time} of ${plural(onTime.total, 'completed milestone')}` : 'No milestones completed yet'}
          icon="checkCircle" tone={onTimeTone}
        />
        {isAdmin ? (
          <>
            <StatCard
              label="Approval turnaround"
              value={k.avg_approval_days === null || k.avg_approval_days === undefined ? '—' : `${k.avg_approval_days.toFixed(1)} days`}
              sub="Average from submission to partner approval"
              icon="clock" tone="info"
            />
            <StatCard
              label="Open delay threads"
              value={k.open_delay_threads ?? 0}
              sub="Awaiting a decision or still under discussion"
              icon="message" tone={k.open_delay_threads > 0 ? 'warning' : 'success'}
            />
          </>
        ) : (
          <>
            <StatCard
              label="Awaiting your approval"
              value={k.awaiting_my_approval ?? 0}
              sub="Milestones submitted for your sign-off"
              icon="inbox" tone={k.awaiting_my_approval > 0 ? 'warning' : 'success'}
            />
            <StatCard
              label="Delays awaiting you"
              value={k.delays_awaiting_me ?? 0}
              sub="Delay threads needing your decision or reply"
              icon="message" tone={k.delays_awaiting_me > 0 ? 'warning' : 'success'}
            />
          </>
        )}
      </div>

      {isAdmin ? (
        <>
          <div className="grid-2">
            <Section title="Delivery throughput" subtitle="Milestones completed each week, last 8 weeks">
              <ThroughputTrend data={data?.throughputTrend} />
            </Section>
            <Section title="Approval pipeline" subtitle="Where completed milestones are in sign-off">
              <ApprovalPipeline data={data?.approvalPipeline} />
            </Section>
            <Section title="Delay responsibility" subtitle="Delayed milestones by the side that caused them">
              <DelayCauses data={data?.delayCauses} />
            </Section>
            <Section title="Lateness by project type" subtitle="Average days past the milestone due date">
              <LateByType data={data?.lateByType} />
            </Section>
          </div>

          <Section
            title="Schedule slippage"
            subtitle="Projects beyond their approved end date, by days over"
            style={{ marginBottom: 20 }}
          >
            <Slippage projects={data?.slippage} navigate={navigate} />
          </Section>
        </>
      ) : (
        <Section title="Upcoming deadlines" subtitle="Next open milestones by approved due date" style={{ marginBottom: 20 }}>
          <Upcoming items={data?.upcoming} navigate={navigate} />
        </Section>
      )}

      <Section title="Project progress" subtitle="Milestones completed in each project" flush>
        <ProjectProgressTable projects={data?.projectProgress} navigate={navigate} />
      </Section>
    </div>
  );
}
