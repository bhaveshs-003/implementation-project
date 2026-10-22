import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { validateProjectStatusTransition, canCompleteProject, auditLog } from '../rules/rules.js';

const router = Router();

function validateDateRange(start, end, label) {
  if (start && end && new Date(end) < new Date(start)) {
    return `${label}: end date cannot be before start date`;
  }
  return null;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    let rows;

    if (req.person.role === 'admin') {
      const params = [];
      let sql = `SELECT id, code, title, type, status, description,
                   company_start_date, company_end_date,
                   partner_start_date, partner_end_date,
                   approved_start_date, approved_end_date,
                   created_at
                 FROM projects WHERE deleted_at IS NULL`;
      if (q) { params.push(`%${q}%`); sql += ` AND (code ILIKE $1 OR title ILIKE $1)`; }
      sql += ' ORDER BY created_at DESC';
      rows = (await query(sql, params)).rows;
    } else {
      const params = [req.person.id];
      let sql = `SELECT p.id, p.code, p.title, p.type, p.status,
                   p.approved_start_date, p.approved_end_date, p.created_at
                 FROM projects p
                 JOIN project_assignments pa ON pa.project_id = p.id
                 WHERE p.deleted_at IS NULL AND pa.person_id = $1 AND pa.assignment_role = 'poc'`;
      if (q) { params.push(`%${q}%`); sql += ` AND (p.code ILIKE $${params.length} OR p.title ILIKE $${params.length})`; }
      sql += ' ORDER BY p.created_at DESC';
      rows = (await query(sql, params)).rows;
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code, title, type, status = 'not_started', description,
      company_start_date, company_end_date,
      partner_start_date, partner_end_date,
      approved_start_date, approved_end_date } = req.body || {};

    if (!code || !title) return res.status(422).json({ error: 'code and title required' });

    const dateErrors = [
      validateDateRange(company_start_date, company_end_date, 'Company'),
      validateDateRange(partner_start_date, partner_end_date, 'Partner'),
      validateDateRange(approved_start_date, approved_end_date, 'Approved'),
    ].filter(Boolean);
    if (dateErrors.length) return res.status(422).json({ error: dateErrors[0] });

    if (!['not_started', 'in_progress', 'completed'].includes(status)) {
      return res.status(422).json({ error: 'Invalid status' });
    }

    const result = await query(
      `INSERT INTO projects (code, title, type, status, description,
         company_start_date, company_end_date,
         partner_start_date, partner_end_date,
         approved_start_date, approved_end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [code, title, type, status, description,
       company_start_date || null, company_end_date || null,
       partner_start_date || null, partner_end_date || null,
       approved_start_date || null, approved_end_date || null,
       req.person.id]
    );
    await auditLog({ query }, { eventType: 'project_created', entityType: 'projects', entityId: result.rows[0].id, actorId: req.person.id, actorRole: req.person.role, newValues: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Project code already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId', requireAuth, resolveProjectScope, (req, res) => {
  // Partners see only approved date range; admins see all three date ranges.
  if (req.person.role !== 'admin') {
    const { company_start_date, company_end_date, partner_start_date, partner_end_date, ...safe } = req.project;
    return res.json(safe);
  }
  res.json(req.project);
});

router.put('/:projectId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const project = req.project;
    const { code, title, type, status, description,
      company_start_date, company_end_date,
      partner_start_date, partner_end_date,
      approved_start_date, approved_end_date,
      confirmCode } = req.body || {};

    const newStatus = status || project.status;
    if (newStatus !== project.status) {
      const { ok, reason } = validateProjectStatusTransition(project.status, newStatus);
      if (!ok) return res.status(422).json({ error: reason });

      if (newStatus === 'completed') {
        if (!confirmCode || confirmCode !== project.code) {
          return res.status(422).json({ error: 'Type the project code to confirm completion' });
        }
        const [msRes, apRes] = await Promise.all([
          query('SELECT * FROM milestones WHERE project_id = $1', [project.id]),
          query('SELECT * FROM approvals WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = $1)', [project.id]),
        ]);
        const { ok: cOk, reason: cReason } = canCompleteProject(project, msRes.rows, apRes.rows);
        if (!cOk) return res.status(422).json({ error: cReason });
      }
    }

    const dateErrors = [
      validateDateRange(company_start_date, company_end_date, 'Company'),
      validateDateRange(partner_start_date, partner_end_date, 'Partner'),
      validateDateRange(approved_start_date, approved_end_date, 'Approved'),
    ].filter(Boolean);
    if (dateErrors.length) return res.status(422).json({ error: dateErrors[0] });

    const result = await query(
      `UPDATE projects SET
         code = COALESCE($1, code),
         title = COALESCE($2, title),
         type = COALESCE($3, type),
         status = $4,
         description = COALESCE($5, description),
         company_start_date = COALESCE($6, company_start_date),
         company_end_date = COALESCE($7, company_end_date),
         partner_start_date = COALESCE($8, partner_start_date),
         partner_end_date = COALESCE($9, partner_end_date),
         approved_start_date = COALESCE($10, approved_start_date),
         approved_end_date = COALESCE($11, approved_end_date),
         updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [code, title, type, newStatus, description,
       company_start_date, company_end_date,
       partner_start_date, partner_end_date,
       approved_start_date, approved_end_date,
       project.id]
    );
    await auditLog({ query }, { eventType: 'project_updated', entityType: 'projects', entityId: project.id, actorId: req.person.id, actorRole: req.person.role, oldValues: project, newValues: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Project code already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 5) {
      return res.status(422).json({ error: 'A written reason of at least 5 characters is required' });
    }
    await query('UPDATE projects SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [req.project.id]);
    await auditLog({ query }, { eventType: 'project_deleted', entityType: 'projects', entityId: req.project.id, actorId: req.person.id, actorRole: req.person.role, meta: { reason } });
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/assignments', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const result = await query(
      `SELECT pa.assignment_role, p.id, p.name, p.email, p.role, p.job_title
       FROM project_assignments pa JOIN people p ON p.id = pa.person_id
       WHERE pa.project_id = $1 ORDER BY p.name`,
      [req.project.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/assignments', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const { person_id, assignment_role } = req.body || {};
    if (!person_id) return res.status(422).json({ error: 'person_id required' });
    if (!['poc', 'resource'].includes(assignment_role)) return res.status(422).json({ error: 'assignment_role must be poc or resource' });

    await query(
      `INSERT INTO project_assignments (project_id, person_id, assignment_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, person_id) DO UPDATE SET assignment_role = EXCLUDED.assignment_role`,
      [req.project.id, person_id, assignment_role]
    );
    await auditLog({ query }, { eventType: 'assignment_added', entityType: 'projects', entityId: req.project.id, actorId: req.person.id, actorRole: req.person.role, meta: { person_id, assignment_role } });
    res.status(201).json({ message: 'Assigned' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/assignments/:personId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM project_assignments WHERE project_id = $1 AND person_id = $2',
      [req.project.id, req.params.personId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
    await auditLog({ query }, { eventType: 'assignment_removed', entityType: 'projects', entityId: req.project.id, actorId: req.person.id, actorRole: req.person.role, meta: { person_id: req.params.personId } });
    res.json({ message: 'Removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
