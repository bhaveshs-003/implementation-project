import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { InlineLoader, useDelayedLoading } from '../components/Spinner.jsx';
import { fmtDateTime } from '../lib/format.js';

const CATEGORIES = ['All', 'project', 'milestone', 'user', 'auth', 'comment', 'resource'];

/* ── Sortable header cell ── */
function SortTh({ label, colKey, sortKey, sortDir, onSort }) {
  const active = sortKey === colKey;
  return (
    <th
      className={`sortable${active ? ' sorted' : ''}`}
      onClick={() => onSort(colKey)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="row" style={{ gap: 4 }}>
        {label}
        <Icon
          name={active ? (sortDir === 'asc' ? 'arrowUp' : 'arrowDown') : 'chevronsUpDown'}
          size={12}
          style={{ opacity: active ? 1 : 0.5 }}
        />
      </span>
    </th>
  );
}

export default function AuditTrail() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const PAGE_SIZE = 25;
  const searchTimeout = useRef(null);
  const showLoader = useDelayedLoading(loading);

  const load = useCallback(async (q, cat, pg, sk, sd) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cat && cat !== 'All') params.set('category', cat);
      params.set('page', pg);
      params.set('limit', PAGE_SIZE);
      params.set('sort', sk);
      params.set('order', sd);
      const data = await apiFetch(`/api/audit?${params.toString()}`);
      setLogs(data.data || data.logs || []);
      setTotal(data.total || 0);
    } catch {
      setError('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(search, category, page, sortKey, sortDir); }, [page, category, sortKey, sortDir]);

  const handleSearch = (val) => {
    setSearch(val);
    setPage(1);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => load(val, category, 1, sortKey, sortDir), 400);
  };

  const handleCategory = (cat) => {
    setCategory(cat);
    setPage(1);
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const renderChanges = (changes) => {
    if (!changes) return '—';
    if (typeof changes === 'string') return changes;
    if (typeof changes === 'object') {
      return Object.entries(changes).map(([k, v]) => (
        <div key={k} className="text-xs muted" style={{ marginBottom: 2, wordBreak: 'break-word' }}>
          <span className="fw-600" style={{ color: 'var(--text)' }}>{k}</span>: {Array.isArray(v) ? `${v[0]} → ${v[1]}` : String(v)}
        </div>
      ));
    }
    return JSON.stringify(changes);
  };

  const sortProps = { sortKey, sortDir, onSort: handleSort };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail</h1>
          <p className="page-subtitle">A complete, searchable record of changes across the workspace.</p>
        </div>
      </div>

      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}

      <div className="card">
        {/* Filters */}
        <div className="card-header wrap">
          <div className="input-group" style={{ flex: '1 1 260px', maxWidth: 320 }}>
            <Icon name="search" />
            <input
              className="input"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search events, actors, entities…"
              aria-label="Search audit logs"
            />
          </div>
          <div className="pill-group" role="tablist" aria-label="Filter by category">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={category === cat}
                className={`pill${category === cat ? ' active' : ''}`}
                onClick={() => handleCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading && logs.length === 0 ? (
          showLoader ? <InlineLoader message="Loading audit logs…" /> : <div style={{ padding: 40 }} />
        ) : logs.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Icon name="history" /></div>
            <div className="empty-title">No audit logs found</div>
            <div className="empty-text">Try adjusting your search or category filter.</div>
          </div>
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s' }} aria-busy={loading}>
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Timestamp" colKey="created_at" {...sortProps} />
                  <SortTh label="Event Type" colKey="event_type" {...sortProps} />
                  <SortTh label="Entity" colKey="entity_type" {...sortProps} />
                  <SortTh label="Actor" colKey="actor_id" {...sortProps} />
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id || Math.random()}>
                    <td className="muted text-sm" style={{ whiteSpace: 'nowrap', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' }}>{fmtDateTime(log.created_at)}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      <span className="badge badge-primary">{log.event_type || '—'}</span>
                    </td>
                    <td style={{ verticalAlign: 'top', fontWeight: 500, textTransform: 'capitalize' }}>
                      {log.entity_type || '—'}
                      {log.entity_id && <span className="mono text-xs subtle" style={{ marginLeft: 6, textTransform: 'none' }}>#{log.entity_id}</span>}
                    </td>
                    <td className="muted" style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{log.actor_name || '—'}</td>
                    <td className="text-xs muted" style={{ verticalAlign: 'top', minWidth: 220 }}>{renderChanges(log.changes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <div className="pagination-info">
              Page {page} of {totalPages} · {total} total records
            </div>
            <div className="pagination-pages">
              <button type="button" className="page-btn" onClick={() => setPage(1)} disabled={page === 1} title="First page" aria-label="First page">«</button>
              <button type="button" className="page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} title="Previous page" aria-label="Previous page">
                <Icon name="chevronLeft" size={14} style={{ verticalAlign: 'middle' }} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                return (
                  <button key={p} type="button" className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined}>
                    {p}
                  </button>
                );
              })}
              <button type="button" className="page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} title="Next page" aria-label="Next page">
                <Icon name="chevronRight" size={14} style={{ verticalAlign: 'middle' }} />
              </button>
              <button type="button" className="page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages} title="Last page" aria-label="Last page">»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
