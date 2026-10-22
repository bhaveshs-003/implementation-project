import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import ProgressBar from '../components/ProgressBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Icon from '../components/Icon.jsx';
import { PageLoader, useDelayedLoading } from '../components/Spinner.jsx';

/* ── Chart theme ── */
const C = {
  primary: '#6366f1',
  success: '#10b981',
  danger: '#f43f5e',
  warning: '#f59e0b',
  violet: '#8b5cf6',
  slate: '#94a3b8',
};
const GRID = { vertical: false, stroke: '#eef0f3' };
const AXIS = { axisLine: false, tickLine: false, tick: { fill: '#94a3b8', fontSize: 12 } };
const TOOLTIP = {
  contentStyle: {
    background: '#fff', border: '1px solid #e6e8ec', borderRadius: 10,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)', fontSize: 13, padding: '8px 12px',
  },
  labelStyle: { color: '#0f172a', fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { fill: '#f3f4f6' },
};
const LEGEND = { iconType: 'circle', iconSize: 8, wrapperStyle: { fontSize: 12, color: '#475569', paddingTop: 8 } };
const MARGIN = { top: 20, right: 8, left: -12, bottom: 0 };

const STAT_TONES = {
  primary: { background: 'var(--primary-soft)', color: 'var(--primary)' },
  info: { background: 'var(--info-soft)', color: 'var(--info)' },
  slate: { background: 'var(--slate-soft)', color: 'var(--text-2)' },
  success: { background: 'var(--success-soft)', color: 'var(--success)' },
};

/* ── Stat Card ── */
function StatCard({ label, value, icon, tone = 'primary' }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={STAT_TONES[tone]}><Icon name={icon} /></span>
      </div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  );
}

/* ── Section Card ── */
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

function NoData({ text = 'No data available.' }) {
  return (
    <div className="empty" style={{ padding: '32px 16px' }}>
      <div className="empty-icon"><Icon name="inbox" /></div>
      <div className="empty-text">{text}</div>
    </div>
  );
}

function LegendDot({ color, children }) {
  return (
    <span className="row text-sm muted" style={{ gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {children}
    </span>
  );
}

/* ── Custom Bar Label ── */
const renderBarLabel = (props) => {
  const { x, y, width, value } = props;
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 6} fill="#475569" textAnchor="middle" fontSize={11} fontWeight={600}>{value}</text>
  );
};

/* ── On-Time vs Delayed ── */
/* API returns [{on_time: bool, count: "N"}] — pivot to [{label, on_time, delayed}] */
function OnTimeDelayed({ data }) {
  if (!data || !data.length) return <NoData />;

  const onTimeRow = data.find(r => r.on_time === true);
  const delayedRow = data.find(r => r.on_time === false);
  const chartData = [{
    label: 'All Milestones',
    on_time: parseInt(onTimeRow?.count || 0),
    delayed: parseInt(delayedRow?.count || 0),
  }];

  const totalOnTime = chartData[0].on_time;
  const totalDelayed = chartData[0].delayed;
  const total = totalOnTime + totalDelayed;
  const pctOnTime = total > 0 ? Math.round((totalOnTime / total) * 100) : 0;
  const pctDelayed = total > 0 ? Math.round((totalDelayed / total) * 100) : 0;

  return (
    <>
      <div className="row wrap" style={{ gap: 20, marginBottom: 12 }}>
        <LegendDot color={C.success}>On Time: <strong style={{ color: 'var(--text)' }}>{totalOnTime}</strong> ({pctOnTime}%)</LegendDot>
        <LegendDot color={C.danger}>Delayed: <strong style={{ color: 'var(--text)' }}>{totalDelayed}</strong> ({pctDelayed}%)</LegendDot>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={MARGIN}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip {...TOOLTIP} />
          <Bar dataKey="on_time" stackId="a" fill={C.success} name="On Time" radius={[0, 0, 0, 0]} maxBarSize={72}>
            <LabelList dataKey="on_time" content={renderBarLabel} />
          </Bar>
          <Bar dataKey="delayed" stackId="a" fill={C.danger} name="Delayed" radius={[6, 6, 0, 0]} maxBarSize={72}>
            <LabelList dataKey="delayed" content={renderBarLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/* ── Delay Attribution ── */
/* API returns [{delay_side: string|null, count: "N"}] — pivot to single object */
function DelayAttribution({ data }) {
  if (!data || !data.length) return <NoData />;

  const obj = { company_side: 0, partner_side: 0, unattributed: 0 };
  for (const row of data) {
    if (row.delay_side === 'company') obj.company_side = parseInt(row.count || 0);
    else if (row.delay_side === 'partner') obj.partner_side = parseInt(row.count || 0);
    else obj.unattributed += parseInt(row.count || 0);
  }

  const chartData = [
    { name: 'Company Side', value: obj.company_side, fill: C.warning },
    { name: 'Partner Side', value: obj.partner_side, fill: C.violet },
    { name: 'Unattributed', value: obj.unattributed, fill: C.slate },
  ];
  return (
    <ResponsiveContainer width="100%" height={252}>
      <BarChart data={chartData} margin={MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis allowDecimals={false} {...AXIS} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="value" name="Delays" radius={[6, 6, 0, 0]} maxBarSize={56}>
          {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          <LabelList dataKey="value" content={renderBarLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Delays by Project Type ── */
/* API returns [{type, delay_side, count}] — aggregate delays per project type */
function DelaysByType({ data }) {
  if (!data || !data.length) return <NoData />;

  const byType = {};
  for (const row of data) {
    const t = row.type || 'Unknown';
    if (!byType[t]) byType[t] = { type: t, company: 0, partner: 0, unattributed: 0 };
    if (row.delay_side === 'company') byType[t].company += parseInt(row.count || 0);
    else if (row.delay_side === 'partner') byType[t].partner += parseInt(row.count || 0);
    else byType[t].unattributed += parseInt(row.count || 0);
  }
  const chartData = Object.values(byType);

  return (
    <ResponsiveContainer width="100%" height={252}>
      <BarChart data={chartData} margin={MARGIN} barGap={4}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="type" {...AXIS} />
        <YAxis allowDecimals={false} {...AXIS} />
        <Tooltip {...TOOLTIP} />
        <Legend {...LEGEND} />
        <Bar dataKey="company" name="Company" fill={C.warning} radius={[6, 6, 0, 0]} maxBarSize={28}>
          <LabelList dataKey="company" content={renderBarLabel} />
        </Bar>
        <Bar dataKey="partner" name="Partner" fill={C.violet} radius={[6, 6, 0, 0]} maxBarSize={28}>
          <LabelList dataKey="partner" content={renderBarLabel} />
        </Bar>
        <Bar dataKey="unattributed" name="Unattributed" fill={C.slate} radius={[6, 6, 0, 0]} maxBarSize={28}>
          <LabelList dataKey="unattributed" content={renderBarLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Throughput Trend (Line) ── */
/* API returns [{week: date, completions: "N"}] */
function ThroughputTrend({ data }) {
  if (!data || !data.length) return <NoData />;

  const chartData = data.map(row => ({
    week: new Date(row.week).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    completions: parseInt(row.completions || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={252}>
      <LineChart data={chartData} margin={MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="week" {...AXIS} />
        <YAxis allowDecimals={false} {...AXIS} />
        <Tooltip {...TOOLTIP} cursor={{ stroke: '#e6e8ec', strokeWidth: 1 }} />
        <Legend {...LEGEND} />
        <Line
          type="monotone" dataKey="completions" name="Completed Milestones"
          stroke={C.primary} strokeWidth={2.5}
          dot={{ r: 3, fill: '#fff', stroke: C.primary, strokeWidth: 2 }}
          activeDot={{ r: 5, fill: C.primary, stroke: '#fff', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Delayed Projects List ── */
/* API returns [{id, code, title, company_delays, partner_delays, unattributed_delays}] */
function DelayedProjectsList({ projects, navigate }) {
  if (!projects || !projects.length) return <NoData text="No delayed projects." />;
  return (
    <div className="list">
      {projects.map((p) => {
        const companyDelays = parseInt(p.company_delays || 0);
        const partnerDelays = parseInt(p.partner_delays || 0);
        const unattributedDelays = parseInt(p.unattributed_delays || 0);
        const totalDelays = companyDelays + partnerDelays + unattributedDelays;
        return (
          <div
            key={p.id}
            className="list-item clickable"
            onClick={() => navigate(`/projects/${p.id}`)}
          >
            <span className="stat-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', flexShrink: 0 }}>
              <Icon name="alertTriangle" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fw-600 truncate">
                <span className="mono text-sm muted">{p.code}</span>
                <span style={{ margin: '0 8px', color: 'var(--text-3)' }}>·</span>
                {p.title}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                <span className="badge badge-warning">Company {companyDelays}</span>
                <span className="badge badge-violet">Partner {partnerDelays}</span>
                <span className="badge">Unattributed {unattributedDelays}</span>
              </div>
            </div>
            <span className="badge badge-danger" style={{ fontWeight: 600 }}>
              {totalDelays} delay{totalDelays !== 1 ? 's' : ''}
            </span>
            <Icon name="chevronRight" size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Project Progress Table ── */
function ProjectProgressTable({ projects }) {
  const [sortKey, setSortKey] = useState('title');
  const [sortDir, setSortDir] = useState('asc');

  if (!projects || !projects.length) return <NoData text="No projects." />;

  const sorted = [...projects].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
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
            {[['code', 'Code'], ['title', 'Title'], ['type', 'Type'], ['status', 'Status'], ['progress', 'Progress']].map(([key, label]) => (
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
          {sorted.map((p) => {
            const total = parseInt(p.total_milestones || 0);
            const done = parseInt(p.completed_milestones || 0);
            return (
              <tr key={p.id}>
                <td className="mono muted">{p.code}</td>
                <td className="fw-600">{p.title}</td>
                <td className="muted">{p.type || '—'}</td>
                <td>{p.status ? <StatusBadge status={p.status} /> : '—'}</td>
                <td style={{ minWidth: 200 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <div style={{ flex: 1 }}><ProgressBar value={done} max={total} showLabel /></div>
                    <span className="text-xs subtle" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {done}/{total}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
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

  const counters = data?.counters || {};

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

      {/* Stat Cards */}
      <div className="stat-grid">
        <StatCard label="Total Projects" value={counters.total} icon="layers" tone="primary" />
        <StatCard label="In Progress" value={counters.in_progress} icon="activity" tone="info" />
        <StatCard label="Not Started" value={counters.not_started} icon="clock" tone="slate" />
        <StatCard label="Completed" value={counters.completed} icon="checkCircle" tone="success" />
      </div>

      {/* Admin Analytics */}
      {isAdmin && (
        <>
          <div className="grid-2">
            <Section title="On-Time vs Delayed" subtitle="Milestone delivery against due dates">
              <OnTimeDelayed data={data?.onTimeVsDelayed} />
            </Section>
            <Section title="Delay Attribution" subtitle="Which side caused milestone delays">
              <DelayAttribution data={data?.delayAttribution} />
            </Section>
            <Section title="Delays by Project Type" subtitle="Delays per type, split by side">
              <DelaysByType data={data?.qualityByType} />
            </Section>
            <Section title="Throughput Trend" subtitle="Completed milestones over the last 8 weeks">
              <ThroughputTrend data={data?.throughputTrend} />
            </Section>
          </div>

          <Section title="Delayed Projects" subtitle="Projects with one or more delayed milestones" style={{ marginBottom: 20 }}>
            <DelayedProjectsList projects={data?.delayedProjects} navigate={navigate} />
          </Section>

          <Section title="Project Progress" subtitle="Milestone completion across all projects" flush>
            <ProjectProgressTable projects={data?.projectProgress} />
          </Section>
        </>
      )}
    </div>
  );
}
