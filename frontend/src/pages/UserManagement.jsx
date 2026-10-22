import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import Icon, { Avatar } from '../components/Icon.jsx';
import { PageLoader, useDelayedLoading } from '../components/Spinner.jsx';

/* ── Add/Edit Resource Modal ── */
function ResourceModal({ resource, onSave, onClose }) {
  const isEdit = !!resource?.id;
  const [name, setName] = useState(resource?.name || '');
  const [jobTitle, setJobTitle] = useState(resource?.job_title || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEdit) {
        await apiFetch(`/api/people/${resource.id}`, { method: 'PUT', body: { name, job_title: jobTitle } });
      } else {
        await apiFetch('/api/people/resources', { method: 'POST', body: { name, job_title: jobTitle } });
      }
      onSave();
    } catch (err) {
      setError(err.error || 'Save failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit Resource' : 'Add Resource'}
      subtitle={isEdit ? 'Update this team member’s details.' : 'Add a company team member who can be assigned to projects.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button form="res-form" type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : isEdit ? 'Save' : 'Add Resource'}</button>
        </>
      }
    >
      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}
      <form id="res-form" onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="res-name">Name *</label>
          <input id="res-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Full name" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label" htmlFor="res-title">Job Title <span className="label-hint">Optional</span></label>
          <input id="res-title" className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Solutions Consultant" />
        </div>
      </form>
    </Modal>
  );
}

/* ── Add/Edit Partner POC Modal ── */
function PartnerPOCModal({ poc, onSave, onClose }) {
  const isEdit = !!poc?.id;
  const [name, setName] = useState(poc?.name || '');
  const [email, setEmail] = useState(poc?.email || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isEdit && password.length < 10) { setError('Password must be at least 10 characters.'); return; }
    setLoading(true);
    try {
      if (isEdit) {
        const body = { name, email };
        if (password) body.password = password;
        await apiFetch(`/api/people/${poc.id}`, { method: 'PUT', body });
      } else {
        await apiFetch('/api/people/partner-pocs', { method: 'POST', body: { name, email, password } });
      }
      onSave();
    } catch (err) {
      setError(err.error || 'Save failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit Partner POC' : 'Add Partner POC'}
      subtitle={isEdit ? 'Update login details for this partner contact.' : 'Create a login for a partner point of contact.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button form="poc-form" type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : isEdit ? 'Save' : 'Add Partner POC'}</button>
        </>
      }
    >
      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}
      <form id="poc-form" onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="poc-name">Name *</label>
          <input id="poc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Full name" />
        </div>
        <div className="field">
          <label className="label" htmlFor="poc-email">Email *</label>
          <input id="poc-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@partner.com" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label" htmlFor="poc-password">
            {isEdit ? <>New Password <span className="label-hint">Leave blank to keep current</span></> : 'Password *'}
          </label>
          <input id="poc-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!isEdit} minLength={isEdit ? 0 : 10} placeholder={isEdit ? 'Leave blank to keep unchanged' : 'Minimum 10 characters'} />
          {!isEdit && <div className="help">Must be at least 10 characters.</div>}
        </div>
      </form>
    </Modal>
  );
}

/* ── Delete Confirmation ── */
function DeleteConfirmModal({ item, type, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setLoading(true);
    try {
      const url = `/api/people/${item.id}`;
      await apiFetch(url, { method: 'DELETE' });
      onConfirm();
    } catch (err) {
      setError(err.error || 'Delete failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`Delete ${type === 'resource' ? 'Resource' : 'Partner POC'}`}
      subtitle="This action cannot be undone."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={loading}>
            <Icon name="trash" />
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <div className="text-sm muted mb-8">Are you sure you want to delete this person?</div>
      <div className="person-row mb-16">
        <Avatar name={item.name} />
        <div className="person-meta">
          <div className="person-name">{item.name}</div>
          {(item.email || item.job_title) && <div className="person-sub">{item.email || item.job_title}</div>}
        </div>
      </div>
      <div className="alert alert-warning" style={{ marginBottom: 0 }}>
        <Icon name="alertTriangle" />
        <div>This person will be removed from all projects they are currently assigned to.</div>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}><Icon name="alert" />{error}</div>}
    </Modal>
  );
}

/* ── Section ── */
function Section({ title, subtitle, count, children, action }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="card-title">{title}</span>
            {count != null && <span className="badge">{count}</span>}
          </div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div style={{ padding: '4px 24px' }}>{children}</div>
    </div>
  );
}

/* ── User Row ── */
function UserRow({ item, onEdit, onDelete, extra, extraIcon, roleBadge }) {
  return (
    <div className="list-item">
      <Avatar name={item.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="fw-600 truncate">{item.name}</span>
          {roleBadge}
        </div>
        {extra && (
          <div className="row text-xs muted" style={{ gap: 5, marginTop: 2 }}>
            {extraIcon && <Icon name={extraIcon} size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
            <span className="truncate">{extra}</span>
          </div>
        )}
      </div>
      <div className="cell-actions">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onEdit} title={`Edit ${item.name}`} aria-label={`Edit ${item.name}`}>
          <Icon name="edit" />
        </button>
        <button type="button" className="btn btn-danger-ghost btn-icon btn-sm" onClick={onDelete} title={`Delete ${item.name}`} aria-label={`Delete ${item.name}`}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

/* ── Empty list ── */
function EmptyList({ icon, title, text }) {
  return (
    <div className="empty" style={{ padding: '36px 16px' }}>
      <div className="empty-icon"><Icon name={icon} /></div>
      <div className="empty-title">{title}</div>
      <div className="empty-text">{text}</div>
    </div>
  );
}

/* ── Main ── */
export default function UserManagement() {
  const [resources, setResources] = useState([]);
  const [pocs, setPocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editResource, setEditResource] = useState(null);
  const [showAddResource, setShowAddResource] = useState(false);
  const [deleteResource, setDeleteResource] = useState(null);

  const [editPoc, setEditPoc] = useState(null);
  const [showAddPoc, setShowAddPoc] = useState(false);
  const [deletePoc, setDeletePoc] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/people');
      setResources(data.resources || []);
      setPocs(data.partnerPocs || []);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const showLoader = useDelayedLoading(loading);

  if (loading) return showLoader ? <PageLoader message="Loading users…" /> : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage company resources and partner points of contact.</p>
        </div>
      </div>
      {error && <div className="alert alert-error"><Icon name="alert" />{error}</div>}

      <div className="grid-2">
        {/* Company Resources */}
        <Section
          title="Company Resources"
          subtitle="Team members who can be assigned to projects"
          count={resources.length}
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddResource(true)}>
              <Icon name="plus" />
              Add Resource
            </button>
          }
        >
          {resources.length === 0 ? (
            <EmptyList icon="briefcase" title="No resources yet" text="Add company team members to assign them to projects." />
          ) : (
            <div className="list">
              {resources.map((r) => (
                <UserRow
                  key={r.id}
                  item={r}
                  extra={r.job_title}
                  extraIcon="briefcase"
                  roleBadge={<span className="badge badge-info">Resource</span>}
                  onEdit={() => setEditResource(r)}
                  onDelete={() => setDeleteResource(r)}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Partner POCs */}
        <Section
          title="Partner POCs"
          subtitle="Partner contacts with login access"
          count={pocs.length}
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddPoc(true)}>
              <Icon name="userPlus" />
              Add Partner POC
            </button>
          }
        >
          {pocs.length === 0 ? (
            <EmptyList icon="users" title="No partner POCs yet" text="Add partner contacts so they can sign in to their projects." />
          ) : (
            <div className="list">
              {pocs.map((p) => (
                <UserRow
                  key={p.id}
                  item={p}
                  extra={p.email}
                  extraIcon="mail"
                  roleBadge={<span className="badge badge-violet">Partner POC</span>}
                  onEdit={() => setEditPoc(p)}
                  onDelete={() => setDeletePoc(p)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Resource Modals */}
      {showAddResource && (
        <ResourceModal onSave={() => { setShowAddResource(false); load(); }} onClose={() => setShowAddResource(false)} />
      )}
      {editResource && (
        <ResourceModal resource={editResource} onSave={() => { setEditResource(null); load(); }} onClose={() => setEditResource(null)} />
      )}
      {deleteResource && (
        <DeleteConfirmModal item={deleteResource} type="resource" onConfirm={() => { setDeleteResource(null); load(); }} onClose={() => setDeleteResource(null)} />
      )}

      {/* POC Modals */}
      {showAddPoc && (
        <PartnerPOCModal onSave={() => { setShowAddPoc(false); load(); }} onClose={() => setShowAddPoc(false)} />
      )}
      {editPoc && (
        <PartnerPOCModal poc={editPoc} onSave={() => { setEditPoc(null); load(); }} onClose={() => setEditPoc(null)} />
      )}
      {deletePoc && (
        <DeleteConfirmModal item={deletePoc} type="poc" onConfirm={() => { setDeletePoc(null); load(); }} onClose={() => setDeletePoc(null)} />
      )}
    </div>
  );
}
