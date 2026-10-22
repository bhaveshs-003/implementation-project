import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import Icon, { Avatar } from '../components/Icon.jsx';
import { ProjectDetailSkeleton, useDelayedLoading } from '../components/Spinner.jsx';

const STATUS_ORDER = ['not_started', 'in_progress', 'completed'];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
function fmtRange(s, e) { return (s || e) ? `${fmtDate(s)} – ${fmtDate(e)}` : '—'; }

// ── Small presentational helpers (module-level) ─────────────────────────────
function ModalError({ message }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" style={{ marginBottom: 0 }}>
      <Icon name="alert" />
      <span>{message}</span>
    </div>
  );
}

function StatTile({ label, value, icon, tone = 'primary', sub }) {
  const tones = {
    primary: { background: 'var(--primary-soft)', color: 'var(--primary)' },
    success: { background: 'var(--success-soft)', color: 'var(--success)' },
    info: { background: 'var(--info-soft)', color: 'var(--info)' },
    violet: { background: 'var(--violet-soft)', color: 'var(--violet)' },
  };
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={tones[tone]}><Icon name={icon} /></span>
      </div>
      <div className="stat-value" style={typeof value === 'string' && value.length > 8 ? { fontSize: 18, letterSpacing: '-0.01em' } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs subtle">{sub}</div>}
    </div>
  );
}

function DateRow({ label, value, icon = 'calendar' }) {
  return (
    <div className="list-item">
      <span className="stat-icon" style={{ width: 30, height: 30, background: 'var(--slate-soft)', color: 'var(--text-2)' }}>
        <Icon name={icon} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-xs subtle">{label}</div>
        <div className="fw-600 text-sm">{value}</div>
      </div>
    </div>
  );
}

// ── @mention input ──────────────────────────────────────────────────────────
function MentionInput({ value, onChange, placeholder, resources = [], multiline, rows = 3, style: extraStyle = {} }) {
  const [dropdown, setDropdown] = useState([]);
  const [show, setShow] = useState(false);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      const after = val.slice(lastAt + 1);
      if (!after.includes(' ') && after.length <= 30) {
        const matches = resources.filter(r => r.name.toLowerCase().includes(after.toLowerCase()));
        setDropdown(matches);
        setShow(matches.length > 0);
        return;
      }
    }
    setShow(false);
  };

  const insertMention = (name) => {
    const lastAt = value.lastIndexOf('@');
    onChange(value.slice(0, lastAt + 1) + name + ' ');
    setShow(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      {multiline ? (
        <textarea className="textarea" value={value} onChange={handleChange} placeholder={placeholder} rows={rows} style={extraStyle} />
      ) : (
        <input className="input" value={value} onChange={handleChange} placeholder={placeholder} style={extraStyle} />
      )}
      {show && (
        <div className="mention-menu" role="listbox">
          {dropdown.map(r => (
            <div
              key={r.id}
              className="mention-item"
              role="option"
              aria-selected="false"
              onMouseDown={(e) => { e.preventDefault(); insertMention(r.name); }}
            >
              <Avatar name={r.name} size="sm" />
              <span className="fw-600">@{r.name}</span>
              {r.job_title && <span className="subtle text-xs truncate">{r.job_title}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Assign Modal ────────────────────────────────────────────────────────────
function AssignModal({ role, eligible, onSave, onClose, saving }) {
  const [selected, setSelected] = useState(role === 'resource' ? [] : null);
  const [search, setSearch] = useState('');

  const toggleResource = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filtered = search.trim()
    ? eligible.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.email || '').toLowerCase().includes(search.toLowerCase()))
    : eligible;

  const canSave = role === 'poc' ? selected !== null : selected.length > 0;
  const label = role === 'poc' ? 'Partner POC' : 'Resources';

  const selectedPoc = role === 'poc' && selected ? eligible.find(p => p.id === selected) : null;
  const selectedResources = role === 'resource' ? eligible.filter(p => selected.includes(p.id)) : [];

  return (
    <Modal
      title={`Assign ${label}`}
      subtitle={role === 'poc' ? 'Choose one partner point of contact for this project.' : 'Select one or more organisation resources.'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onSave(role === 'poc' ? [selected] : selected)}
            disabled={!canSave || saving}
          >
            {saving ? 'Assigning...' : role === 'poc' ? 'Assign POC' : `Assign ${selected.length > 0 ? `(${selected.length})` : ''}`}
          </button>
        </>
      }
    >
      {/* Selection preview */}
      {role === 'poc' && selectedPoc && (
        <div className="person-row mb-16" style={{ borderColor: 'var(--primary)', background: 'var(--primary-soft)' }}>
          <Avatar name={selectedPoc.name} />
          <div className="person-meta">
            <div className="text-xs fw-600" style={{ color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Selected POC</div>
            <div className="person-name">{selectedPoc.name}</div>
            {(selectedPoc.email || selectedPoc.job_title) && (
              <div className="person-sub">{[selectedPoc.email, selectedPoc.job_title].filter(Boolean).join(' · ')}</div>
            )}
          </div>
          <Icon name="checkCircle" size={18} style={{ color: 'var(--primary)' }} />
        </div>
      )}
      {role === 'resource' && selectedResources.length > 0 && (
        <div className="mb-16">
          <div className="text-xs fw-600 subtle mb-8" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Selected ({selectedResources.length})
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {selectedResources.map(r => (
              <span key={r.id} className="chip">
                {r.name}
                <button type="button" onClick={() => toggleResource(r.id)} aria-label={`Remove ${r.name}`}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      {eligible.length > 0 && (
        <div className="input-group mb-16">
          <Icon name="search" />
          <input
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            autoFocus={eligible.length > 4}
          />
        </div>
      )}

      {eligible.length === 0 ? (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <div className="empty-icon"><Icon name="users" /></div>
          <div className="empty-title">No one left to assign</div>
          <div className="empty-text">
            No {role === 'poc' ? 'partner POCs' : 'resources'} available to assign. All eligible people are already assigned.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty" style={{ padding: '24px 16px' }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <div className="empty-text">No matches for "{search}"</div>
        </div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
          {filtered.map(p => {
            const isSelected = role === 'poc' ? selected === p.id : selected.includes(p.id);
            return (
              <div
                key={p.id}
                className={`choice${isSelected ? ' selected' : ''}`}
                onClick={() => role === 'poc' ? setSelected(p.id) : toggleResource(p.id)}
              >
                <input
                  type={role === 'poc' ? 'radio' : 'checkbox'}
                  readOnly
                  checked={isSelected}
                  tabIndex={-1}
                  style={{ width: 16, height: 16, flexShrink: 0 }}
                />
                <Avatar name={p.name} size="sm" />
                <div className="person-meta">
                  <div className="person-name">{p.name}</div>
                  {(p.email || p.job_title) && (
                    <div className="person-sub">{[p.email, p.job_title].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
                {isSelected && <Icon name="check" size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ── MilestoneCard — module-level to prevent focus loss ──────────────────────
function MilestoneCard({ ms, project, isAdmin, openModal, actions, busy, onReviewDelays }) {
  const openSubtasks = (ms.sub_tasks || []).filter(st => st.status !== 'completed');
  const pendingDelays = (ms.delays || []).filter(d => d.status !== 'accepted').length;
  const awaitingPartner = !isAdmin && ms.approval?.status === 'pending';
  const subTasks = ms.sub_tasks || [];
  const doneSubtasks = subTasks.length - openSubtasks.length;
  const isApproved = ms.approval?.status === 'approved';
  const awaitingSubmission = isAdmin && ms.status === 'completed' && !ms.approval;

  return (
    <div className={`card mb-16${awaitingSubmission ? ' card-attention' : ''}`}>
      <div className="card-header" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
          <span className="stat-icon" style={{
            width: 32, height: 32, flexShrink: 0,
            background: ms.status === 'completed' ? 'var(--success-soft)' : 'var(--primary-soft)',
            color: ms.status === 'completed' ? 'var(--success)' : 'var(--primary)',
          }}>
            <Icon name="flag" />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="card-title">{ms.title}</span>
              <StatusBadge status={ms.status} />
              {awaitingSubmission && <span className="badge badge-warning">Ready to submit for approval</span>}
            </div>
            <div className="row wrap text-sm muted" style={{ gap: 12, marginTop: 4 }}>
              {ms.approved_start_date && (
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="calendar" size={14} style={{ color: 'var(--text-3)' }} />
                  {fmtRange(ms.approved_start_date, ms.approved_end_date)}
                </span>
              )}
              {subTasks.length > 0 && (
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="checkCircle" size={14} style={{ color: 'var(--text-3)' }} />
                  {doneSubtasks}/{subTasks.length} sub-tasks
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="row wrap">
          {isAdmin && ms.status !== 'completed' && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => openModal('complete-milestone', { milestoneId: ms.id })}
              disabled={project.status !== 'in_progress' || openSubtasks.length > 0}
              title={openSubtasks.length > 0 ? `${openSubtasks.length} sub-task(s) still open` : ''}
            >
              <Icon name="checkCircle" />
              Mark Complete
            </button>
          )}
          {isAdmin && ms.status === 'completed' && !ms.approval && (
            <button
              className="btn btn-soft btn-sm"
              onClick={() => actions.submitApproval(ms)}
              disabled={busy[`approval-${ms.id}`]}
            >
              <Icon name="send" />
              {busy[`approval-${ms.id}`] ? 'Submitting…' : 'Submit for Approval'}
            </button>
          )}
          {awaitingPartner && (
            <button
              className="btn btn-success btn-sm"
              onClick={() => openModal('approve', { milestoneId: ms.id })}
            >
              <Icon name="check" />
              {pendingDelays > 0 ? 'Review & Approve' : 'Approve'}
            </button>
          )}
          {!isAdmin && !ms.approval && (
            <span className="badge">Not yet submitted for approval</span>
          )}
        </div>
      </div>

      <div className="card-body" style={{ paddingTop: 16, paddingBottom: 16 }}>
        {awaitingPartner && pendingDelays > 0 && (
          <div className="alert alert-warning row-between" style={{ marginBottom: 14 }}>
            <span className="row" style={{ gap: 8 }}>
              <Icon name="alertTriangle" />
              {pendingDelays} delay{pendingDelays !== 1 ? 's need' : ' needs'} your decision before this milestone can be approved.
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReviewDelays}>Review delays</button>
          </div>
        )}
        {ms.approval && (
          <div className={`alert ${isApproved ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: subTasks.length > 0 || (isAdmin && ms.status !== 'completed') ? 14 : 0 }}>
            <Icon name={isApproved ? 'checkCircle' : 'clock'} />
            <div className="row wrap" style={{ gap: 6 }}>
              <span>Approval:</span>
              <strong style={{ textTransform: 'capitalize' }}>{ms.approval.status}</strong>
              {isApproved && ms.approval.approved_by_name && <span>by {ms.approval.approved_by_name}</span>}
              {isAdmin && ms.approval.rating && (
                <span className="row" style={{ gap: 4 }}>
                  · <Icon name="star" size={13} /> {ms.approval.rating}/5
                </span>
              )}
              {isAdmin && ms.approval.comment && <span>· "{ms.approval.comment}"</span>}
            </div>
          </div>
        )}

        {subTasks.length > 0 && (
          <div className="list">
            {subTasks.map(st => {
              const done = st.status === 'completed';
              const pending = busy[`st-${st.id}`];
              const canTick = isAdmin && !done;
              const tickDisabled = project.status !== 'in_progress' || pending;
              return (
                <div key={st.id} className="list-item" style={{ padding: '8px 0' }}>
                  {canTick ? (
                    <button
                      type="button"
                      className="subtask-check"
                      onClick={() => actions.completeSubtask(ms, st)}
                      disabled={tickDisabled}
                      aria-label={`Mark "${st.title}" as done`}
                      title={project.status !== 'in_progress' ? 'Project must be in progress' : 'Mark as done'}
                    >
                      <Icon name="circle" size={18} className="icon-default" />
                      <Icon name="checkCircle" size={18} className="icon-hover" />
                    </button>
                  ) : (
                    <Icon
                      name={done ? 'checkCircle' : 'circle'}
                      size={18}
                      style={{ color: done ? 'var(--success)' : 'var(--text-3)', flexShrink: 0 }}
                    />
                  )}
                  <span className="text-sm" style={{
                    flex: 1, minWidth: 0,
                    textDecoration: done ? 'line-through' : 'none',
                    color: done ? 'var(--text-3)' : 'var(--text)',
                  }}>
                    {st.title}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {subTasks.length === 0 && !ms.approval && !(isAdmin && ms.status !== 'completed') && (
          <div className="text-sm subtle">No sub-tasks.</div>
        )}

        {isAdmin && ms.status !== 'completed' && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => openModal('add-subtask', { milestoneId: ms.id })}
            style={{ marginTop: subTasks.length > 0 ? 8 : 0, marginLeft: -10 }}
          >
            <Icon name="plus" />
            Sub-task
          </button>
        )}
      </div>
    </div>
  );
}

// ── MilestonesTab — module-level ────────────────────────────────────────────
function MilestonesTab({ milestones, project, assignments, isAdmin, projectId, modal, form, handleField, modalError, saving, openModal, closeModal, doSave, actions, busy, onReviewDelays }) {
  const approvingMs = modal?.type === 'approve' ? milestones.find(m => m.id === modal.milestoneId) : null;
  const blockingDelays = (approvingMs?.delays || []).filter(d => d.status !== 'accepted');
  const doneMs = milestones.filter(m => m.status === 'completed').length;

  return (
    <div>
      <div className="row-between mb-16">
        <div>
          <div className="card-title">Milestones</div>
          <div className="card-subtitle">{doneMs} of {milestones.length} completed</div>
        </div>
        {isAdmin && project.status !== 'completed' && (
          <button className="btn btn-primary" onClick={() => openModal('add-milestone')}>
            <Icon name="plus" />
            Add Milestone
          </button>
        )}
      </div>

      {milestones.length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="empty-icon"><Icon name="flag" /></div>
            <div className="empty-title">No milestones yet</div>
            <div className="empty-text">Milestones break the project into trackable phases with their own sub-tasks and approvals.</div>
          </div>
        </div>
      )}

      {milestones.map(ms => (
        <MilestoneCard key={ms.id} ms={ms} project={project} isAdmin={isAdmin} openModal={openModal} actions={actions} busy={busy} onReviewDelays={onReviewDelays} />
      ))}

      {/* Add Milestone Modal */}
      {modal?.type === 'add-milestone' && (
        <Modal
          title="Add Milestone"
          subtitle={`${project.code} · ${project.title}`}
          onClose={closeModal}
          footer={
            <>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => doSave(() => apiFetch(`/api/projects/${projectId}/milestones`, { method: 'POST', body: form }), { apply: actions.milestoneAdded })}
                disabled={!form.title || saving}
              >
                {saving ? 'Saving...' : 'Add Milestone'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label" htmlFor="ms-title">Title *</label>
            <input
              id="ms-title"
              className="input"
              value={form.title || ''}
              onChange={e => handleField('title', e.target.value)}
              placeholder="Milestone title"
              autoFocus
            />
          </div>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="ms-start">Approved Start Date</label>
              <input
                id="ms-start"
                type="date"
                className="input"
                value={form.approved_start_date || ''}
                onChange={e => handleField('approved_start_date', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="ms-end">Approved End Date</label>
              <input
                id="ms-end"
                type="date"
                className="input"
                value={form.approved_end_date || ''}
                onChange={e => handleField('approved_end_date', e.target.value)}
              />
            </div>
          </div>
          <ModalError message={modalError} />
        </Modal>
      )}

      {/* Complete Milestone Modal */}
      {modal?.type === 'complete-milestone' && (
        <Modal
          title="Mark Milestone Complete"
          onClose={closeModal}
          footer={
            <>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => doSave(() => apiFetch(`/api/projects/${projectId}/milestones/${modal.milestoneId}/complete`, {
                  method: 'POST',
                  body: { on_time: form.on_time !== 'false', delay_side: form.delay_side, delay_reason: form.delay_reason },
                }), { apply: actions.milestoneUpdated })}
                disabled={!form.on_time || (form.on_time === 'false' && !form.delay_side) || saving}
              >
                {saving ? 'Saving...' : 'Mark Complete'}
              </button>
            </>
          }
        >
          <div className="field">
            <span className="label">Was this milestone completed on time?</span>
            {[['true', 'Yes, on time', 'checkCircle'], ['false', 'No, delayed', 'alertTriangle']].map(([v, l, icon]) => (
              <label key={v} className={`choice${form.on_time === v ? ' selected' : ''}`}>
                <input type="radio" name="on_time" value={v} checked={form.on_time === v}
                  onChange={() => handleField('on_time', v)} />
                <Icon name={icon} size={16} style={{ color: v === 'true' ? 'var(--success)' : 'var(--warning)' }} />
                <span className="fw-600 text-sm">{l}</span>
              </label>
            ))}
          </div>
          {form.on_time === 'false' && (
            <>
              <div className="field">
                <label className="label" htmlFor="delay-side">Delay side *</label>
                <select id="delay-side" className="select" value={form.delay_side || ''} onChange={e => handleField('delay_side', e.target.value)}>
                  <option value="">Select...</option>
                  <option value="company">Company</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="delay-reason">Delay reason</label>
                <textarea id="delay-reason" className="textarea" value={form.delay_reason || ''} onChange={e => handleField('delay_reason', e.target.value)}
                  rows={3} />
                <div className="help">This opens a delay thread the other side can accept or dispute.</div>
              </div>
            </>
          )}
          <ModalError message={modalError} />
        </Modal>
      )}

      {/* Approve Modal */}
      {modal?.type === 'approve' && (
        <Modal
          title="Approve Milestone"
          subtitle={approvingMs?.title}
          onClose={closeModal}
          footer={
            <>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-success"
                onClick={() => doSave(() => apiFetch(`/api/projects/${projectId}/milestones/${modal.milestoneId}/approval/approve`, {
                  method: 'POST',
                  body: { rating: form.rating, comment: form.comment },
                }), { apply: actions.approvalUpdated })}
                disabled={blockingDelays.length > 0 || !form.rating || !form.comment?.trim() || saving}
              >
                {saving ? 'Approving...' : 'Approve'}
              </button>
            </>
          }
        >
          {blockingDelays.length > 0 && (
            <div className="alert alert-warning">
              <Icon name="alertTriangle" />
              <div style={{ flex: 1 }}>
                <div className="fw-600" style={{ marginBottom: 4 }}>
                  Approval is blocked by {blockingDelays.length} outstanding delay{blockingDelays.length !== 1 ? 's' : ''}
                </div>
                <ul style={{ paddingLeft: 16, marginBottom: 8 }}>
                  {blockingDelays.map(d => (
                    <li key={d.id}>
                      {d.side === 'company' ? 'Company' : 'Partner'} delay ({d.status}){d.reason ? ` — ${d.reason}` : ''}
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { closeModal(); onReviewDelays(); }}>
                  Review delays
                </button>
              </div>
            </div>
          )}
          <div className="field">
            <span className="label">Rating (1–5) *</span>
            <div className="row">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`btn btn-icon ${form.rating === n ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleField('rating', n)}
                  aria-pressed={form.rating === n}
                  style={{ width: 42, fontWeight: 600 }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Comment * <span className="label-hint">(type @ to mention anyone on the project)</span></span>
            <MentionInput
              value={form.comment || ''}
              onChange={v => handleField('comment', v)}
              placeholder="Add your comments… type @name to mention someone"
              resources={assignments}
              multiline
              rows={4}
            />
          </div>
          <ModalError message={modalError} />
        </Modal>
      )}

      {/* Add Sub-task Modal */}
      {modal?.type === 'add-subtask' && (
        <Modal
          title="Add Sub-task"
          onClose={closeModal}
          footer={
            <>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => doSave(() => apiFetch(`/api/projects/${projectId}/milestones/${modal.milestoneId}/subtasks`, { method: 'POST', body: { title: form.title } }), { apply: actions.subtaskAdded })}
                disabled={!form.title || saving}
              >
                {saving ? 'Adding...' : 'Add'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label" htmlFor="st-title">Title</label>
            <input
              id="st-title"
              className="input"
              placeholder="Sub-task title"
              value={form.title || ''}
              onChange={e => handleField('title', e.target.value)}
              autoFocus
            />
          </div>
          <ModalError message={modalError} />
        </Modal>
      )}
    </div>
  );
}

// ── DelayThread — module-level ───────────────────────────────────────────────
function DelayThread({ delay, isAdmin, projectId, resources, onChanged }) {
  const [replyBody, setReplyBody] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [localDelay, setLocalDelay] = useState(delay);
  const [actionError, setActionError] = useState('');

  useEffect(() => { setLocalDelay(delay); }, [delay]);

  const refresh = async () => {
    const dl = await apiFetch(`/api/projects/${projectId}/delays`);
    let updated = null;
    for (const group of dl) {
      if (Array.isArray(group.delays)) {
        updated = group.delays.find(d => d.id === delay.id) || null;
        if (updated) break;
      }
    }
    if (updated) setLocalDelay(updated);
  };

  const doAction = async (action, body = {}) => {
    setReplyLoading(true);
    setActionError('');
    try {
      await apiFetch(`/api/projects/${projectId}/delays/${localDelay.id}/${action}`, { method: 'POST', body });
      await refresh();
      if (action === 'deny') setDenyReason('');
      onChanged?.();
    } catch (err) {
      setActionError(typeof err?.error === 'string' ? err.error : 'Action failed. Please try again.');
    }
    finally { setReplyLoading(false); }
  };

  const isCompany = localDelay.side === 'company';

  return (
    <div className="card mb-16">
      <div className="card-header" style={{ padding: '14px 20px' }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <span className={`badge ${isCompany ? 'badge-violet' : 'badge-info'}`}>
            <Icon name={isCompany ? 'briefcase' : 'users'} size={12} />
            {isCompany ? 'Company' : 'Partner'} Delay
          </span>
          <span className="row text-xs subtle" style={{ gap: 4 }}>
            <Icon name="clock" size={12} />
            {fmtDate(localDelay.created_at)}
          </span>
        </div>
        <StatusBadge status={localDelay.status} />
      </div>

      <div className="card-body" style={{ padding: '16px 20px' }}>
        <p className="text-sm" style={{ color: 'var(--text)', marginBottom: (localDelay.messages || []).length > 0 ? 14 : 0 }}>
          {localDelay.reason}
        </p>

        {(localDelay.messages || []).map(msg => (
          <div key={msg.id} className="message">
            <div className="message-meta row" style={{ gap: 6 }}>
              <Avatar name={msg.author_name} size="sm" />
              <span className="fw-600" style={{ color: 'var(--text-2)' }}>{msg.author_name}</span>
              <span>· {msg.action || 'reply'} · {fmtDate(msg.created_at)}</span>
            </div>
            <div className="text-sm" style={{ paddingLeft: 32 }}>{msg.body}</div>
          </div>
        ))}

        {actionError && (
          <div className="alert alert-error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>
            <Icon name="alert" />
            <span>{actionError}</span>
          </div>
        )}
        {localDelay.status === 'accepted' && (
          <div className="alert alert-success" style={{ marginTop: 12, marginBottom: 0 }}>
            <Icon name="checkCircle" />
            <span>Thread closed — delay accepted.</span>
          </div>
        )}
      </div>

      {localDelay.status !== 'accepted' && (
        (!isAdmin && localDelay.status === 'pending') || localDelay.status === 'denied'
      ) && (
        <div className="card-footer" style={{ padding: '14px 20px' }}>
          {!isAdmin && localDelay.status === 'pending' && (
            <div className="row wrap">
              <button className="btn btn-success btn-sm" onClick={() => doAction('accept')} disabled={replyLoading}>
                <Icon name="check" />
                Accept Delay
              </button>
              <input
                className="input input-sm"
                placeholder="Deny reason (required)"
                value={denyReason}
                onChange={e => setDenyReason(e.target.value)}
                style={{ flex: 1, minWidth: 180, width: 'auto' }}
              />
              <button className="btn btn-danger btn-sm" onClick={() => doAction('deny', { reason: denyReason })} disabled={!denyReason.trim() || replyLoading}>
                <Icon name="x" />
                Deny
              </button>
            </div>
          )}
          {localDelay.status === 'denied' && (
            <div>
              {!isAdmin && (
                <button className="btn btn-success btn-sm mb-8" onClick={() => doAction('accept')} disabled={replyLoading}>
                  <Icon name="check" />
                  Accept &amp; Close
                </button>
              )}
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MentionInput
                    value={replyBody}
                    onChange={setReplyBody}
                    placeholder={`${isAdmin ? 'Admin reply' : 'Reply'}… type @name to mention someone`}
                    resources={resources}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => { doAction('reply', { body: replyBody }); setReplyBody(''); }}
                  disabled={!replyBody.trim() || replyLoading}
                >
                  <Icon name="send" />
                  Send Reply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CommentsTab — module-level ───────────────────────────────────────────────
function CommentsTab({ delays, milestones, isAdmin, projectId, resources, onChanged }) {
  const grouped = {};
  delays.forEach(group => {
    if (Array.isArray(group.delays)) {
      group.delays.forEach(d => { (grouped[d.milestone_id] ||= []).push(d); });
    }
  });

  return (
    <div>
      {Object.keys(grouped).length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="empty-icon"><Icon name="message" /></div>
            <div className="empty-title">No delay threads</div>
            <div className="empty-text">Delay threads are created when a milestone is marked as completed late.</div>
          </div>
        </div>
      )}
      {milestones.filter(m => grouped[m.id]).map(m => (
        <div key={m.id} className="mb-24">
          <div className="row mb-8" style={{ gap: 8 }}>
            <Icon name="flag" size={14} style={{ color: 'var(--text-3)' }} />
            <h4 className="text-sm fw-600" style={{ color: 'var(--text-2)' }}>{m.title}</h4>
            <span className="tab-count">{grouped[m.id].length}</span>
          </div>
          {grouped[m.id].map(delay => (
            <DelayThread key={delay.id} delay={delay} isAdmin={isAdmin} projectId={projectId} resources={resources} onChanged={onChanged} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── TeamCard — module-level ──────────────────────────────────────────────────
function TeamCard({ title, subtitle, items, role, isAdmin, openModal, actions, busy }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{title} <span className="subtle" style={{ fontWeight: 500 }}>({items.length})</span></div>
          <div className="card-subtitle">{subtitle}</div>
        </div>
        {isAdmin && (
          <button className="btn btn-soft btn-sm" onClick={() => openModal('assign', { role })}>
            <Icon name="plus" />
            Assign
          </button>
        )}
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <div className="row text-sm subtle" style={{ gap: 8 }}>
            <Icon name="user" size={16} />
            None assigned.
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map(a => (
              <div key={a.id} className="person-row">
                <Avatar name={a.name} />
                <div className="person-meta">
                  <div className="person-name">{a.name}</div>
                  {(a.email || a.job_title) && (
                    <div className="person-sub">{[a.email, a.job_title].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
                {isAdmin && (
                  <button
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => actions.removeAssignment(a)}
                    disabled={busy[`asg-${a.id}`]}
                  >
                    {busy[`asg-${a.id}`] ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AdvanceStatusModal — module-level; rendered by ProjectDetail so it works on any tab
function AdvanceStatusModal({ project, projectId, form, handleField, modalError, saving, closeModal, doSave, actions }) {
  const nextStatus = STATUS_ORDER[STATUS_ORDER.indexOf(project.status) + 1];
  return (
    <Modal
      title="Advance Project Status"
      onClose={closeModal}
      footer={
        <>
          <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              doSave(() => apiFetch(`/api/projects/${projectId}`, {
                method: 'PUT',
                body: { status: nextStatus, confirmCode: form.confirmCode },
              }), { apply: actions.projectUpdated });
            }}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Confirm'}
          </button>
        </>
      }
    >
      <p className="text-sm mb-16">
        Move <strong className="mono">{project.code}</strong> from{' '}
        <StatusBadge status={project.status} /> to <StatusBadge status={nextStatus} />?
      </p>
      {nextStatus === 'completed' && (
        <div className="field">
          <label className="label" htmlFor="confirm-code">Type the project code to confirm</label>
          <input
            id="confirm-code"
            className="input"
            value={form.confirmCode || ''}
            onChange={e => handleField('confirmCode', e.target.value)}
            placeholder={project.code}
            autoFocus
          />
          <div className="help">Project status only moves forward, so this cannot be undone.</div>
        </div>
      )}
      <ModalError message={modalError} />
    </Modal>
  );
}

// ── OverviewTab — module-level ───────────────────────────────────────────────
function OverviewTab({ project, milestones, assignments, allPeople, isAdmin, modal, saving, openModal, closeModal, onAssign, actions, busy }) {
  const pocs = assignments.filter(a => a.assignment_role === 'poc');
  const resources = assignments.filter(a => a.assignment_role === 'resource');
  const totalMs = milestones.length;
  const doneMs = milestones.filter(m => m.status === 'completed').length;
  const pct = Math.min(100, Math.round((doneMs / (totalMs || 1)) * 100));

  const eligibleForRole = (role) => allPeople
    .filter(p => role === 'poc' ? p.role === 'partner_poc' : p.role === 'resource')
    .filter(p => !assignments.find(a => a.id === p.id));

  return (
    <div>
      <div className="stat-grid">
        <StatTile label="Progress" value={`${pct}%`} icon="trending" tone="primary" />
        <StatTile label="Milestones" value={`${doneMs}/${totalMs}`} icon="flag" tone="success" sub="completed" />
        <StatTile label="Team" value={assignments.length} icon="users" tone="violet" sub={`${pocs.length} POC · ${resources.length} resources`} />
        <StatTile label="Approved dates" value={fmtRange(project.approved_start_date, project.approved_end_date)} icon="calendar" tone="info" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Progress</div>
              <div className="card-subtitle">{doneMs} of {totalMs} milestones completed</div>
            </div>
            <StatusBadge status={project.status} />
          </div>
          <div className="card-body">
            <ProgressBar value={doneMs} max={totalMs || 1} showLabel />
            {project.description && (
              <p className="text-sm muted mt-16" style={{ whiteSpace: 'pre-wrap' }}>{project.description}</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Dates</div>
          </div>
          <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="list">
              <DateRow label="Approved" value={fmtRange(project.approved_start_date, project.approved_end_date)} />
              {isAdmin && <DateRow label="Company" value={fmtRange(project.company_start_date, project.company_end_date)} icon="briefcase" />}
              {isAdmin && <DateRow label="Partner" value={fmtRange(project.partner_start_date, project.partner_end_date)} icon="users" />}
            </div>
          </div>
        </div>
      </div>

      {/* Assignments */}
      <div className="grid-2">
        <TeamCard
          title="Partner POC" subtitle="Partner-side point of contact"
          items={pocs} role="poc"
          isAdmin={isAdmin} openModal={openModal} actions={actions} busy={busy}
        />
        <TeamCard
          title="Organisation Resources" subtitle="People delivering this project"
          items={resources} role="resource"
          isAdmin={isAdmin} openModal={openModal} actions={actions} busy={busy}
        />
      </div>

      {/* Assign Modal */}
      {modal?.type === 'assign' && (
        <AssignModal
          role={modal.role}
          eligible={eligibleForRole(modal.role)}
          onSave={(ids) => onAssign(ids, modal.role)}
          onClose={closeModal}
          saving={saving}
        />
      )}
    </div>
  );
}

// ── Main ProjectDetail ───────────────────────────────────────────────────────
export default function ProjectDetail() {
  const { id } = useParams();
  const { person } = useAuth();
  const navigate = useNavigate();
  const isAdmin = person?.role === 'admin';

  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [delays, setDelays] = useState([]);
  const [allPeople, setAllPeople] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState('');
  // Background refreshes are discarded if superseded or if a mutation is still in flight,
  // so a stale response can't overwrite an optimistic update.
  const loadSeq = useRef(0);
  const inFlight = useRef(0);

  const loadProject = useCallback(async (background = false) => {
    const seq = ++loadSeq.current;
    try {
      const [proj, ms, asgn, dl] = await Promise.all([
        apiFetch(`/api/projects/${id}`),
        apiFetch(`/api/projects/${id}/milestones`),
        apiFetch(`/api/projects/${id}/assignments`),
        apiFetch(`/api/projects/${id}/delays`),
      ]);
      if (seq !== loadSeq.current || inFlight.current > 0) return;
      setProject(proj);
      setMilestones(ms);
      setAssignments(asgn);
      setDelays(dl);
    } catch {
      if (!background) navigate('/projects');
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const tasks = [loadProject()];
      if (isAdmin) {
        tasks.push(
          apiFetch('/api/people')
            .then(data => setAllPeople([...(data.resources || []), ...(data.partnerPocs || [])]))
            .catch(() => {})
        );
      }
      await Promise.all(tasks);
      setLoading(false);
    };
    init();
  }, [loadProject, isAdmin]);

  const showSkeleton = useDelayedLoading(loading || !project);
  if (loading || !project) return showSkeleton ? <ProjectDetailSkeleton /> : null;

  const openModal = (type, data = {}) => { setModal({ type, ...data }); setForm({}); setModalError(''); };
  const closeModal = () => setModal(null);
  const handleField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Modal saves (no key): close as soon as the server confirms, merge the result locally,
  // then reconcile with a background refresh. Inline actions (key): optimistic + per-button busy state.
  const doSave = async (fn, { key, optimistic, apply } = {}) => {
    if (key) setBusy(b => ({ ...b, [key]: true })); else setSaving(true);
    setModalError('');
    inFlight.current += 1;
    if (optimistic) optimistic();
    try {
      const result = await fn();
      if (apply && result && typeof result === 'object') apply(result);
      if (!key) closeModal();
    } catch (err) {
      const msg = err?.error || 'An error occurred';
      if (key) setToast(typeof msg === 'string' ? msg : 'An error occurred');
      else setModalError(msg);
    } finally {
      inFlight.current -= 1;
      if (key) setBusy(b => { const n = { ...b }; delete n[key]; return n; }); else setSaving(false);
      loadProject(true);
    }
  };

  const updateMilestone = (msId, fn) => setMilestones(prev => prev.map(m => (m.id === msId ? fn(m) : m)));

  const actions = {
    completeSubtask: (ms, st) => doSave(
      () => apiFetch(`/api/projects/${id}/milestones/${ms.id}/subtasks/${st.id}/complete`, { method: 'POST' }),
      {
        key: `st-${st.id}`,
        optimistic: () => updateMilestone(ms.id, m => ({
          ...m, sub_tasks: (m.sub_tasks || []).map(s => (s.id === st.id ? { ...s, status: 'completed' } : s)),
        })),
      },
    ),
    submitApproval: (ms) => doSave(
      () => apiFetch(`/api/projects/${id}/milestones/${ms.id}/submit-approval`, { method: 'POST' }),
      { key: `approval-${ms.id}`, apply: (row) => updateMilestone(ms.id, m => ({ ...m, approval: row })) },
    ),
    removeAssignment: (a) => doSave(
      () => apiFetch(`/api/projects/${id}/assignments/${a.id}`, { method: 'DELETE' }),
      { key: `asg-${a.id}`, optimistic: () => setAssignments(prev => prev.filter(x => x.id !== a.id)) },
    ),
    milestoneAdded: (row) => setMilestones(prev => [...prev, { sub_tasks: [], approval: null, delays: [], ...row }]),
    milestoneUpdated: (row) => updateMilestone(row.id, m => ({ ...m, ...row })),
    subtaskAdded: (row) => updateMilestone(row.milestone_id, m => ({ ...m, sub_tasks: [...(m.sub_tasks || []), row] })),
    approvalUpdated: (row) => updateMilestone(row.milestone_id, m => ({ ...m, approval: { ...(m.approval || {}), ...row } })),
    projectUpdated: (row) => setProject(prev => ({ ...prev, ...row })),
  };

  const handleAssign = async (personIds, role) => {
    setSaving(true);
    setModalError('');
    inFlight.current += 1;
    try {
      await Promise.all(personIds.map(pid => apiFetch(`/api/projects/${id}/assignments`, {
        method: 'POST',
        body: { person_id: pid, assignment_role: role },
      })));
      const added = allPeople
        .filter(p => personIds.includes(p.id))
        .map(p => ({ assignment_role: role, id: p.id, name: p.name, email: p.email, role: p.role, job_title: p.job_title }));
      setAssignments(prev => [...prev.filter(a => !personIds.includes(a.id)), ...added]
        .sort((x, y) => (x.name || '').localeCompare(y.name || '')));
      closeModal();
    } catch (err) {
      setModalError(err?.error || 'An error occurred');
    } finally {
      inFlight.current -= 1;
      setSaving(false);
      loadProject(true);
    }
  };

  const delayThreadCount = delays.reduce((n, g) => n + (Array.isArray(g.delays) ? g.delays.length : 0), 0);
  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'milestones', label: 'Milestones', count: milestones.length },
    { id: 'comments', label: 'Comments', count: delayThreadCount },
  ];
  const canAdvance = isAdmin && STATUS_ORDER.indexOf(project.status) < STATUS_ORDER.length - 1;

  return (
    <div>
      <button className="breadcrumb" onClick={() => navigate('/projects')}>
        <Icon name="chevronLeft" />
        Projects
      </button>

      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">
            <span className="mono" style={{ color: 'var(--text-3)', fontWeight: 500, fontSize: '0.8em', marginRight: 10 }}>{project.code}</span>
            {project.title}
          </h1>
          <div className="page-subtitle row wrap" style={{ gap: 8 }}>
            {project.type && (
              <span className="row" style={{ gap: 6 }}>
                <Icon name="layers" size={14} style={{ color: 'var(--text-3)' }} />
                {project.type}
              </span>
            )}
            <StatusBadge status={project.status} />
          </div>
        </div>
        {canAdvance && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => openModal('advance-status')}>
              Advance Status
            </button>
          </div>
        )}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          project={project} milestones={milestones} assignments={assignments}
          allPeople={allPeople} isAdmin={isAdmin}
          modal={modal} saving={saving}
          openModal={openModal} closeModal={closeModal}
          onAssign={handleAssign} actions={actions} busy={busy}
        />
      )}
      {tab === 'milestones' && (
        <MilestonesTab
          milestones={milestones} project={project} assignments={assignments}
          isAdmin={isAdmin} projectId={id}
          modal={modal} form={form} handleField={handleField}
          modalError={modalError} saving={saving}
          openModal={openModal} closeModal={closeModal} doSave={doSave}
          actions={actions} busy={busy} onReviewDelays={() => setTab('comments')}
        />
      )}
      {tab === 'comments' && (
        <CommentsTab
          delays={delays} milestones={milestones}
          isAdmin={isAdmin} projectId={id} resources={assignments}
          onChanged={() => loadProject(true)}
        />
      )}

      {/* Advance Status Modal — mounted regardless of active tab */}
      {modal?.type === 'advance-status' && (
        <AdvanceStatusModal
          project={project} projectId={id}
          form={form} handleField={handleField}
          modalError={modalError} saving={saving}
          closeModal={closeModal} doSave={doSave} actions={actions}
        />
      )}

      {toast && (
        <div className="toast" role="alert">
          <div className="alert alert-error" style={{ marginBottom: 0 }}>
            <Icon name="alert" />
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
