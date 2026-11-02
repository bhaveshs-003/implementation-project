import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { PageLoader, useDelayedLoading } from '../components/Spinner.jsx';

/* Colour-blind-safe palette (validated categorical slots 1-3, muted gray, reserved status red). */
const COLOR = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', gray: '#898781', red: '#d03b3b' };

const TONES = {
  primary: { background: 'var(--primary-soft)', color: 'var(--primary)' },
  info: { background: 'var(--info-soft)', color: 'var(--info)' },
  success: { background: 'var(--success-soft)', color: 'var(--success)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
  slate: { background: 'var(--slate-soft)', color: 'var(--text-2)' },
};

/* A KPI card: title, prominent number and a short label. Clickable when it has a destination. */
function KpiCard({ title, value, label, icon, tone = 'primary', swatch, to, navigate }) {
  const body = (
    <>
      <div className="stat-top">
        <span className="stat-label row" style={{ gap: 6 }}>
          {swatch && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: swatch, display: 'inline-block' }} />}
          {title}
        </span>
        <span className="stat-icon" style={TONES[tone]}><Icon name={icon} /></span>
      </div>
      <div className="stat-value">{value}</div>
      {label && <div className="text-xs subtle">{label}</div>}
    </>
  );
  if (!to) return <div className="card stat">{body}</div>;
  return (
    <button
      type="button"
      className="card stat kpi-link"
      onClick={() => navigate(to)}
      aria-label={`${title}: ${value}. Open details`}
    >
      {body}
    </button>
  );
}

/* One slim proportion bar; values live on the cards, so the bar carries no numbers of its own. */
function ShareBar({ segments, label }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;
  return (
    <div className="share-bar" role="img" aria-label={`${label}: ${segments.filter(s => s.value > 0).map(s => `${s.name} ${s.value}`).join(', ')}`}>
      {segments.filter(s => s.value > 0).map((s) => (
        <span
          key={s.name}
          title={`${s.name}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className="dash-section">
      <h2 className="dash-heading">{title}</h2>
      {subtitle && <p className="text-sm subtle" style={{ margin: '0 0 10px' }}>{subtitle}</p>}
      {children}
    </section>
  );
}

function AdminDashboard({ data, navigate }) {
  const p = data.portfolio;
  const d = data.delivery;
  const a = data.approvals;
  const classified = p.completed_on_time + p.completed_delayed;
  const unclassifiedNote = p.completed_unclassified > 0
    ? `${p.completed_unclassified} completed project${p.completed_unclassified === 1 ? '' : 's'} not classified (no approved end date or milestones)`
    : null;

  return (
    <>
      <Section title="Portfolio snapshot" subtitle={unclassifiedNote}>
        <div className="stat-grid">
          <KpiCard title="Total projects" value={p.total} label="All projects" icon="layers" tone="primary" to="/projects" navigate={navigate} />
          <KpiCard title="Not started" value={p.not_started} label="Status: Not Started" icon="clock" tone="slate" to="/projects?status=not_started" navigate={navigate} />
          <KpiCard title="In progress" value={p.in_progress} label="Status: In-Progress" icon="activity" tone="info" to="/projects?status=in_progress" navigate={navigate} />
          <KpiCard title="Completed" value={p.completed} label="Status: Completed" icon="checkCircle" tone="success" to="/projects?status=completed" navigate={navigate} />
          <KpiCard title="Completed on time" value={p.completed_on_time} label="Finished by the approved end date" icon="check" tone="success" to="/projects?outcome=on_time" navigate={navigate} />
          <KpiCard title="Completed with delay" value={p.completed_delayed} label="Finished after the approved end date" icon="alertTriangle" tone="danger" to="/projects?outcome=delayed" navigate={navigate} />
        </div>
        {classified === 0 && p.completed > 0 && (
          <p className="text-xs subtle">Completed projects cannot be classified until they have an approved end date and completed milestones.</p>
        )}
      </Section>

      <Section title="Delivery performance" subtitle="Completed milestones, by the delay responsibility recorded at completion">
        <div className="stat-grid">
          <KpiCard title="Total milestones" value={d.total_milestones} label="Including extended milestones" icon="flag" tone="primary" />
          <KpiCard title="Completed on time" value={d.on_time} label="Milestones" icon="checkCircle" tone="success" swatch={COLOR.blue} to="/projects?milestone=on_time" navigate={navigate} />
          <KpiCard title="Delayed: company side" value={d.company_delay} label="Milestones" icon="briefcase" tone="warning" swatch={COLOR.orange} to="/projects?milestone=company_delay" navigate={navigate} />
          <KpiCard title="Delayed: partner side" value={d.partner_delay} label="Milestones" icon="users" tone="info" swatch={COLOR.aqua} to="/projects?milestone=partner_delay" navigate={navigate} />
        </div>
        <ShareBar
          label="Completed milestones by outcome"
          segments={[
            { name: 'On time', value: d.on_time, color: COLOR.blue },
            { name: 'Delayed: company side', value: d.company_delay, color: COLOR.orange },
            { name: 'Delayed: partner side', value: d.partner_delay, color: COLOR.aqua },
          ]}
        />
      </Section>

      <Section title="Approval & delay" subtitle="Current approval state of each milestone; a milestone is counted once">
        <div className="stat-grid">
          <KpiCard title="Submitted for approval" value={a.submitted} label="Awaiting the partner" icon="send" tone="warning" swatch={COLOR.gray} to="/projects?approval=pending" navigate={navigate} />
          <KpiCard title="Approved" value={a.approved} label="By the Partner POC" icon="checkCircle" tone="success" swatch={COLOR.blue} to="/projects?approval=approved" navigate={navigate} />
          <KpiCard title="Declined" value={a.declined} label="Currently denied" icon="x" tone="danger" swatch={COLOR.red} to="/projects?approval=declined" navigate={navigate} />
          <KpiCard title="Approved by override" value={a.overridden} label="Admin Override & Approve" icon="check" tone="info" swatch={COLOR.orange} to="/projects?approval=overridden" navigate={navigate} />
        </div>
        <ShareBar
          label="Milestones by approval state"
          segments={[
            { name: 'Submitted', value: a.submitted, color: COLOR.gray },
            { name: 'Approved', value: a.approved, color: COLOR.blue },
            { name: 'Declined', value: a.declined, color: COLOR.red },
            { name: 'Approved by override', value: a.overridden, color: COLOR.orange },
          ]}
        />
      </Section>
    </>
  );
}

function PartnerDashboard({ data, navigate }) {
  const p = data.portfolio;
  const d = data.delivery;
  return (
    <>
      <Section title="Portfolio">
        <div className="stat-grid">
          <KpiCard title="Assigned projects" value={p.assigned} label="Projects where you are the POC" icon="layers" tone="primary" to="/projects" navigate={navigate} />
          <KpiCard title="Active projects" value={p.active} label="Status: In-Progress" icon="activity" tone="info" to="/projects?status=in_progress" navigate={navigate} />
          <KpiCard title="Awaiting my approval" value={p.awaiting_my_approval} label="Milestones submitted to you" icon="inbox" tone={p.awaiting_my_approval > 0 ? 'warning' : 'success'} to="/projects?approval=pending" navigate={navigate} />
          <KpiCard title="Completed on time" value={p.milestones_on_time} label="Milestones" icon="checkCircle" tone="success" to="/projects?milestone=on_time" navigate={navigate} />
          <KpiCard title="Delayed milestones" value={p.delayed_milestones} label="Completed with a delay" icon="alertTriangle" tone="danger" to="/projects" navigate={navigate} />
        </div>
      </Section>

      <Section
        title="Delivery overview"
        subtitle={d.projects_unclassified > 0 ? `${d.projects_unclassified} completed project${d.projects_unclassified === 1 ? '' : 's'} not classified (no approved end date or milestones)` : null}
      >
        <div className="stat-grid">
          <KpiCard title="Projects delivered on time" value={d.projects_on_time} label="Finished by the approved end date" icon="check" tone="success" to="/projects?outcome=on_time" navigate={navigate} />
          <KpiCard title="Projects delivered with delay" value={d.projects_delayed} label="Finished after the approved end date" icon="alertTriangle" tone="danger" to="/projects?outcome=delayed" navigate={navigate} />
        </div>
      </Section>
    </>
  );
}

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
      .catch(() => setError('Failed to load dashboard data. Please refresh and try again.'))
      .finally(() => setLoading(false));
  }, []);

  const showLoader = useDelayedLoading(loading);
  if (loading) return showLoader ? <PageLoader message="Loading dashboard…" /> : null;
  if (error) return <div className="alert alert-error"><Icon name="alert" />{error}</div>;
  if (!data?.portfolio) {
    return (
      <div className="alert alert-error">
        <Icon name="alert" />
        The dashboard data is in an unexpected format. The server may still be updating; please refresh in a few minutes.
      </div>
    );
  }

  const hasProjects = isAdmin ? data?.portfolio?.total > 0 : data?.portfolio?.assigned > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {person?.name ? `Welcome back, ${person.name}. ` : ''}
            {isAdmin ? 'A portfolio-wide view of delivery and approvals.' : 'An overview of the projects assigned to you.'}
          </p>
        </div>
      </div>

      {!hasProjects ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon"><Icon name="folder" /></div>
            <div className="empty-title">{isAdmin ? 'No projects yet' : 'No projects assigned to you yet'}</div>
            <div className="empty-text">
              {isAdmin ? 'Create a project to start tracking delivery.' : 'Projects will appear here once an admin assigns you as the Partner POC.'}
            </div>
          </div>
        </div>
      ) : isAdmin ? (
        <AdminDashboard data={data} navigate={navigate} />
      ) : (
        <PartnerDashboard data={data} navigate={navigate} />
      )}
    </div>
  );
}
