import React from 'react';

const STATUS = {
  not_started:      { variant: '',               label: 'Not Started' },
  in_progress:      { variant: 'badge-info',     label: 'In Progress' },
  completed:        { variant: 'badge-success',  label: 'Completed' },
  pending_approval: { variant: 'badge-warning',  label: 'Pending Approval' },
  approved:         { variant: 'badge-success',  label: 'Approved' },
  delayed:          { variant: 'badge-danger',   label: 'Delayed' },
  accepted:         { variant: 'badge-success',  label: 'Accepted' },
  denied:           { variant: 'badge-danger',   label: 'Denied' },
  pending:          { variant: 'badge-warning',  label: 'Pending' },
  on_time:          { variant: 'badge-success',  label: 'On Time' },
  overdue:          { variant: 'badge-danger',   label: 'Overdue' },
};

export default function StatusBadge({ status }) {
  const key = (status || '').toLowerCase().replace(/\s+/g, '_');
  const cfg = STATUS[key] || { variant: '', label: status || '—' };
  return <span className={`badge badge-dot ${cfg.variant}`}>{cfg.label}</span>;
}
