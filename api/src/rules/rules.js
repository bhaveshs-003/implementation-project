// State machine rules enforced server-side.
// Client copies exist only for disabling buttons.

// ── Project status machine ────────────────────────────────────────────────────
const PROJECT_STATUS_ORDER = ['not_started', 'in_progress', 'completed'];

export function canAdvanceProjectStatus(current, next) {
  const ci = PROJECT_STATUS_ORDER.indexOf(current);
  const ni = PROJECT_STATUS_ORDER.indexOf(next);
  return ni === ci + 1;
}

export function validateProjectStatusTransition(current, next) {
  if (!canAdvanceProjectStatus(current, next)) {
    return { ok: false, reason: `Cannot move project from '${current}' to '${next}'` };
  }
  return { ok: true };
}

// ── Milestone status machine ──────────────────────────────────────────────────
const MILESTONE_STATUS_ORDER = ['not_started', 'in_progress', 'completed'];

export function canAdvanceMilestoneStatus(current, next) {
  const ci = MILESTONE_STATUS_ORDER.indexOf(current);
  const ni = MILESTONE_STATUS_ORDER.indexOf(next);
  return ni === ci + 1;
}

// ── Sub-task rules ────────────────────────────────────────────────────────────

export function canCompleteSubTask(subTask, project) {
  if (project.status !== 'in_progress') {
    return { ok: false, reason: 'Project is not in progress' };
  }
  if (subTask.status === 'completed') {
    return { ok: false, reason: 'Sub-task already completed' };
  }
  return { ok: true };
}

// ── Milestone completion rules ────────────────────────────────────────────────

export function canCompleteMilestone(milestone, subTasks, project) {
  if (project.status !== 'in_progress') {
    return { ok: false, reason: 'Project is not in progress' };
  }
  if (milestone.status === 'completed') {
    return { ok: false, reason: 'Milestone already completed' };
  }
  const openTasks = subTasks.filter(st => st.status !== 'completed');
  if (openTasks.length > 0) {
    return { ok: false, reason: `${openTasks.length} sub-task(s) still open` };
  }
  return { ok: true };
}

// ── Submit for approval rules ─────────────────────────────────────────────────

export function canSubmitForApproval(milestone, existingApproval, pocCount) {
  if (milestone.status !== 'completed') {
    return { ok: false, reason: 'Milestone must be completed first' };
  }
  if (pocCount === 0) {
    return { ok: false, reason: 'No Partner POC assigned to this project' };
  }
  if (existingApproval) {
    return { ok: false, reason: 'Already submitted for approval' };
  }
  return { ok: true };
}

// ── Approval rules ────────────────────────────────────────────────────────────

export function canApprove(approval, pendingDelayCount, isPOCOnProject) {
  if (!approval || approval.status !== 'pending') {
    return { ok: false, reason: 'No pending approval' };
  }
  if (!isPOCOnProject) {
    return { ok: false, reason: 'Not authorised' };
  }
  if (pendingDelayCount > 0) {
    return { ok: false, reason: `${pendingDelayCount} delay(s) not yet accepted` };
  }
  return { ok: true };
}

// ── Delay rules ───────────────────────────────────────────────────────────────

export function canAcceptDelay(delay, person) {
  if (delay.status === 'accepted') {
    return { ok: false, reason: 'Already accepted' };
  }
  if (person.role !== 'partner_poc') {
    return { ok: false, reason: 'Only a Partner POC can accept a delay' };
  }
  return { ok: true };
}

export function canDenyDelay(delay, person) {
  if (delay.status !== 'pending') {
    return { ok: false, reason: 'Delay is not in pending state' };
  }
  if (person.role !== 'partner_poc') {
    return { ok: false, reason: 'Only a Partner POC can deny a delay' };
  }
  return { ok: true };
}

export function canReplyToDelay(delay, person) {
  if (delay.status !== 'denied') {
    return { ok: false, reason: 'Replies only allowed on denied threads' };
  }
  // Both roles can reply to a denied thread.
  return { ok: true };
}

// ── Project completion gate ───────────────────────────────────────────────────

export function canCompleteProject(project, milestones, approvals) {
  if (project.status !== 'in_progress') {
    return { ok: false, reason: 'Project is not in progress' };
  }
  for (const m of milestones) {
    if (m.status !== 'completed') {
      return { ok: false, reason: `Milestone '${m.title}' is not completed` };
    }
    const approval = approvals.find(a => a.milestone_id === m.id);
    if (!approval || approval.status !== 'approved') {
      return { ok: false, reason: `Milestone '${m.title}' is not approved` };
    }
  }
  return { ok: true };
}

// ── Audit helper ──────────────────────────────────────────────────────────────

export async function auditLog(db, { eventType, entityType, entityId, actorId, actorRole, oldValues, newValues, meta }) {
  await db.query(
    `INSERT INTO audit_log (event_type, entity_type, entity_id, actor_id, actor_role, old_values, new_values, meta, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      eventType,
      entityType,
      entityId,
      actorId || null,
      actorRole || null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      meta ? JSON.stringify(meta) : null,
    ]
  );
}
