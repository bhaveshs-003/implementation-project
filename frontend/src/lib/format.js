export function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'partner_poc') return 'Partner POC';
  if (role === 'resource') return 'Resource';
  return role || '—';
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
