import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Icon from '../components/Icon.jsx';
import { InlineLoader, useDelayedLoading } from '../components/Spinner.jsx';
import { fmtDate } from '../lib/format.js';

const STATUS_ORDER = ['not_started', 'in_progress', 'completed'];
const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const PROJECT_TYPES = ['Implementation', 'Migration', 'Integration', 'Custom Development', 'Support', 'Other'];

/* ── Project Form Modal ── */
function ProjectFormModal({ project, onSave, onClose }) {
  const isEdit = !!project?.id;
  const currentStatusIdx = isEdit ? STATUS_ORDER.indexOf(project.status) : -1;

  const [form, setForm] = useState({
    code: project?.code || '',
    title: project?.title || '',
    type: project?.type || '',
    status: project?.status || 'not_started',
    description: project?.description || '',
    approved_start_date: project?.approved_start_date?.slice(0, 10) || '',
    approved_end_date: project?.approved_end_date?.slice(0, 10) || '',
    company_start_date: project?.company_start_date?.slice(0, 10) || '',
    company_end_date: project?.company_end_date?.slice(0, 10) || '',
    partner_start_date: project?.partner_start_date?.slice(0, 10) || '',
    partner_end_date: project?.partner_end_date?.slice(0, 10) || '',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isEdit) {
        await apiFetch(`/api/projects/${project.id}`, { method: 'PUT', body: form });
      } else {
        await apiFetch('/api/projects', { method: 'POST', body: form });
      }
      onSave();
    } catch (err) {
      setError(err.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit Project' : 'New Project'}
      subtitle={isEdit ? `${project.code} · ${project.title}` : 'Set up a new project and its planned dates.'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button form="proj-form" type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}
      <form id="proj-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label className="label">Code *</label>
            <input className="input mono" value={form.code} onChange={set('code')} required placeholder="PROJ-001" />
          </div>
          <div className="field">
            <label className="label">Type *</label>
            <select className="select" value={form.type} onChange={set('type')} required>
              <option value="">Select type…</option>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label">Title *</label>
          <input className="input" value={form.title} onChange={set('title')} required placeholder="Project title" />
        </div>
        <div className="field">
          <label className="label">Status</label>
          <select className="select" value={form.status} onChange={set('status')} required>
            {STATUS_ORDER.map((s, idx) => (
              <option key={s} value={s} disabled={isEdit && idx < currentStatusIdx}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {isEdit && <div className="help">Status can only move forward.</div>}
        </div>
        <div className="field">
          <label className="label">Description</label>
          <textarea className="textarea" value={form.description} onChange={set('description')} placeholder="Project description" />
        </div>
        <hr className="divider" />
        <div className="form-section-title">Approved Dates</div>
        <div className="form-grid">
          <div className="field"><label className="label">Start</label><input className="input" type="date" value={form.approved_start_date} onChange={set('approved_start_date')} /></div>
          <div className="field"><label className="label">End</label><input className="input" type="date" value={form.approved_end_date} onChange={set('approved_end_date')} /></div>
        </div>
        <div className="form-section-title">Company Dates</div>
        <div className="form-grid">
          <div className="field"><label className="label">Start</label><input className="input" type="date" value={form.company_start_date} onChange={set('company_start_date')} /></div>
          <div className="field"><label className="label">End</label><input className="input" type="date" value={form.company_end_date} onChange={set('company_end_date')} /></div>
        </div>
        <div className="form-section-title">Partner Dates</div>
        <div className="form-grid">
          <div className="field" style={{ marginBottom: 0 }}><label className="label">Start</label><input className="input" type="date" value={form.partner_start_date} onChange={set('partner_start_date')} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label className="label">End</label><input className="input" type="date" value={form.partner_end_date} onChange={set('partner_end_date')} /></div>
        </div>
      </form>
    </Modal>
  );
}

/* ── Delete Confirmation ── */
function DeleteModal({ project, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (reason.trim().length < 5) { setError('Please provide a reason (minimum 5 characters).'); return; }
    setLoading(true);
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: 'DELETE', body: { reason: reason.trim() } });
      onConfirm();
    } catch (err) {
      setError(err.error || 'Delete failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Delete project"
      subtitle="This action cannot be undone."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={loading}>
            <Icon name="trash" />
            {loading ? 'Deleting…' : 'Delete Project'}
          </button>
        </>
      }
    >
      <div className="alert alert-warning">
        <Icon name="alertTriangle" />
        <div>You are about to permanently delete <strong>{project.code} – {project.title}</strong>. This action cannot be undone.</div>
      </div>
      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Reason for deletion *</label>
        <textarea
          className="textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this project is being deleted (min 5 chars)"
          autoFocus
        />
      </div>
    </Modal>
  );
}

/* ── Main Projects Page ── */
export default function Projects() {
  const { person } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = person?.role === 'admin';

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [deleteProject, setDeleteProject] = useState(null);
  const searchTimeout = useRef(null);
  const showLoader = useDelayedLoading(loading);

  const fetchSeq = useRef(0);

  // Only the first load shows a loader; later refreshes keep current rows visible and
  // drop out-of-order responses (e.g. from fast typing in search).
  const fetchProjects = useCallback(async (q = '') => {
    const seq = ++fetchSeq.current;
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const data = await apiFetch(`/api/projects${qs}`);
      if (seq !== fetchSeq.current) return;
      setProjects(data.projects || data || []);
      setError('');
    } catch {
      if (seq === fetchSeq.current) setError('Failed to load projects.');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects(query);
  }, []);

  const handleSearch = (val) => {
    setQuery(val);
    setSearchParams(val ? { q: val } : {});
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchProjects(val), 350);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">Browse, search and manage all implementation projects.</p>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <button
              className="btn btn-primary"
              onClick={() => { setEditProject(null); setShowForm(true); }}
            >
              <Icon name="plus" />
              New Project
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}

      <div className="card">
        {/* Search */}
        <div className="card-header">
          <div className="input-group" style={{ flex: 1, maxWidth: 360 }}>
            <Icon name="search" />
            <input
              className="input"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by code or title…"
              aria-label="Search projects"
            />
          </div>
          {!loading && (
            <span className="text-sm subtle">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          showLoader ? <InlineLoader message="Loading projects…" /> : <div style={{ padding: 40 }} />
        ) : projects.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Icon name="folder" /></div>
            <div className="empty-title">No projects found</div>
            <div className="empty-text">
              {query ? 'Try a different code or title.' : 'Projects you have access to will appear here.'}
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Approved Dates</th>
                  <th>Status</th>
                  {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="clickable"
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <td className="mono muted">{p.code}</td>
                    <td className="fw-600">{p.title}</td>
                    <td className="muted">{p.type || '—'}</td>
                    <td className="muted text-sm" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(p.approved_start_date)} – {fmtDate(p.approved_end_date)}
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    {isAdmin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            title="Edit project"
                            aria-label="Edit project"
                            onClick={() => { setEditProject(p); setShowForm(true); }}
                          >
                            <Icon name="edit" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-ghost btn-icon btn-sm"
                            title="Delete project"
                            aria-label="Delete project"
                            onClick={() => setDeleteProject(p)}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ProjectFormModal
          project={editProject}
          onSave={() => { setShowForm(false); setEditProject(null); fetchProjects(query); }}
          onClose={() => { setShowForm(false); setEditProject(null); }}
        />
      )}

      {deleteProject && (
        <DeleteModal
          project={deleteProject}
          onConfirm={() => {
            setProjects(prev => prev.filter(x => x.id !== deleteProject.id));
            setDeleteProject(null);
            fetchProjects(query);
          }}
          onClose={() => setDeleteProject(null)}
        />
      )}
    </div>
  );
}
