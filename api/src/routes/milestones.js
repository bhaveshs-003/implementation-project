import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { canCompleteMilestone, canSubmitForApproval, auditLog } from '../rules/rules.js';

const router = Router({ mergeParams: true });

function validateDateRange(start, end, label) {
  if (start && end && new Date(end) < new Date(start)) {
    return `${label}: end date cannot be before start date`;
  }
  return null;
}

router.get('/', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const projectId = req.project.id;

    // Flat read: one query per table
    const [msRes, stRes, apRes, dlRes] = await Promise.all([
      query('SELECT * FROM milestones WHERE project_id = $1 ORDER BY order_index, created_at', [projectId]),
      query('SELECT * FROM sub_tasks WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = $1) ORDER BY order_index, created_at', [projectId]),
      query(`SELECT a.*, p.name AS approved_by_name FROM approvals a LEFT JOIN people p ON p.id = a.approved_by
             WHERE a.milestone_id IN (SELECT id FROM milestones WHERE project_id = $1)`, [projectId]),
      query('SELECT * FROM delays WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = $1)', [projectId]),
    ]);

    const subTaskMap = {};
    stRes.rows.forEach(st => { (subTaskMap[st.milestone_id] ||= []).push(st); });
    const approvalMap = {};
    apRes.rows.forEach(a => { approvalMap[a.milestone_id] = a; });
    const delayMap = {};
    dlRes.rows.forEach(d => { (delayMap[d.milestone_id] ||= []).push(d); });

    const milestones = msRes.rows.map(m => {
      const approval = approvalMap[m.id] || null;
      const safeApproval = approval && req.person.role === 'partner_poc'
        ? { ...approval, rating: undefined, comment: undefined }
        : approval;
      return { ...m, sub_tasks: subTaskMap[m.id] || [], approval: safeApproval, delays: delayMap[m.id] || [] };
    });

    res.json(milestones);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const { title, order_index,
      company_start_date, company_end_date,
      partner_start_date, partner_end_date,
      approved_start_date, approved_end_date } = req.body || {};
    if (!title) return res.status(422).json({ error: 'title required' });

    const dateErrors = [
      validateDateRange(company_start_date, company_end_date, 'Company'),
      validateDateRange(partner_start_date, partner_end_date, 'Partner'),
      validateDateRange(approved_start_date, approved_end_date, 'Approved'),
    ].filter(Boolean);
    if (dateErrors.length) return res.status(422).json({ error: dateErrors[0] });

    const maxIdx = await query('SELECT COALESCE(MAX(order_index),0)+1 AS next FROM milestones WHERE project_id=$1', [req.project.id]);
    const result = await query(
      `INSERT INTO milestones (project_id, title, status, order_index,
         company_start_date, company_end_date, partner_start_date, partner_end_date,
         approved_start_date, approved_end_date)
       VALUES ($1,$2,'not_started',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.project.id, title, order_index ?? maxIdx.rows[0].next,
       company_start_date||null, company_end_date||null,
       partner_start_date||null, partner_end_date||null,
       approved_start_date||null, approved_end_date||null]
    );
    await auditLog({ query }, { eventType: 'milestone_created', entityType: 'milestones', entityId: result.rows[0].id, actorId: req.person.id, actorRole: req.person.role, newValues: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:milestoneId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const ms = await query('SELECT * FROM milestones WHERE id=$1 AND project_id=$2', [req.params.milestoneId, req.project.id]);
    if (!ms.rows.length) return res.status(404).json({ error: 'Milestone not found' });

    const { title, order_index,
      company_start_date, company_end_date,
      partner_start_date, partner_end_date,
      approved_start_date, approved_end_date } = req.body || {};

    const dateErrors = [
      validateDateRange(company_start_date, company_end_date, 'Company'),
      validateDateRange(partner_start_date, partner_end_date, 'Partner'),
      validateDateRange(approved_start_date, approved_end_date, 'Approved'),
    ].filter(Boolean);
    if (dateErrors.length) return res.status(422).json({ error: dateErrors[0] });

    const result = await query(
      `UPDATE milestones SET
         title=COALESCE($1,title), order_index=COALESCE($2,order_index),
         company_start_date=COALESCE($3,company_start_date), company_end_date=COALESCE($4,company_end_date),
         partner_start_date=COALESCE($5,partner_start_date), partner_end_date=COALESCE($6,partner_end_date),
         approved_start_date=COALESCE($7,approved_start_date), approved_end_date=COALESCE($8,approved_end_date),
         updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [title, order_index, company_start_date, company_end_date, partner_start_date, partner_end_date, approved_start_date, approved_end_date, req.params.milestoneId]
    );
    await auditLog({ query }, { eventType: 'milestone_updated', entityType: 'milestones', entityId: result.rows[0].id, actorId: req.person.id, actorRole: req.person.role, oldValues: ms.rows[0], newValues: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:milestoneId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const ms = await query('SELECT id FROM milestones WHERE id=$1 AND project_id=$2', [req.params.milestoneId, req.project.id]);
    if (!ms.rows.length) return res.status(404).json({ error: 'Milestone not found' });
    await query('DELETE FROM milestones WHERE id=$1', [req.params.milestoneId]);
    await auditLog({ query }, { eventType: 'milestone_deleted', entityType: 'milestones', entityId: req.params.milestoneId, actorId: req.person.id, actorRole: req.person.role });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:milestoneId/complete', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const [msRes, stRes] = await Promise.all([
      query('SELECT * FROM milestones WHERE id=$1 AND project_id=$2', [req.params.milestoneId, req.project.id]),
      query('SELECT * FROM sub_tasks WHERE milestone_id=$1', [req.params.milestoneId]),
    ]);
    if (!msRes.rows.length) return res.status(404).json({ error: 'Milestone not found' });

    const { ok, reason } = canCompleteMilestone(msRes.rows[0], stRes.rows, req.project);
    if (!ok) return res.status(422).json({ error: reason });

    const { on_time, delay_side, delay_reason } = req.body || {};
    if (typeof on_time !== 'boolean') {
      return res.status(400).json({ error: 'on_time (boolean) is required' });
    }
    if (!on_time) {
      if (!delay_side || !['company', 'partner'].includes(delay_side)) {
        return res.status(422).json({ error: 'delay_side ("company" or "partner") is required when on_time is false' });
      }
    }

    const result = await query(
      `UPDATE milestones SET status='completed', completed_at=NOW(),
         on_time=$1, delay_side=$2, delay_reason=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [on_time, !on_time ? delay_side : null, !on_time ? (delay_reason || null) : null, req.params.milestoneId]
    );

    if (!on_time) {
      await query(
        `INSERT INTO delays (milestone_id, status, side, reason) VALUES ($1,'pending',$2,$3)`,
        [req.params.milestoneId, delay_side, delay_reason || null]
      );
    }

    await auditLog({ query }, { eventType: 'milestone_completed', entityType: 'milestones', entityId: req.params.milestoneId, actorId: req.person.id, actorRole: req.person.role, meta: { on_time, delay_side } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:milestoneId/submit-approval', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const [msRes, apRes, pocRes] = await Promise.all([
      query('SELECT * FROM milestones WHERE id=$1 AND project_id=$2', [req.params.milestoneId, req.project.id]),
      query('SELECT * FROM approvals WHERE milestone_id=$1', [req.params.milestoneId]),
      query("SELECT COUNT(*)::int AS cnt FROM project_assignments WHERE project_id=$1 AND assignment_role='poc'", [req.project.id]),
    ]);
    if (!msRes.rows.length) return res.status(404).json({ error: 'Milestone not found' });

    const { ok, reason } = canSubmitForApproval(msRes.rows[0], apRes.rows[0] || null, pocRes.rows[0].cnt);
    if (!ok) return res.status(422).json({ error: reason });

    const result = await query(
      `INSERT INTO approvals (milestone_id, status, submitted_at, submitted_by) VALUES ($1,'pending',NOW(),$2) RETURNING *`,
      [req.params.milestoneId, req.person.id]
    );
    await auditLog({ query }, { eventType: 'approval_submitted', entityType: 'approvals', entityId: result.rows[0].id, actorId: req.person.id, actorRole: req.person.role });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
