import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { canApprove, auditLog } from '../rules/rules.js';

const router = Router({ mergeParams: true });

// POST /approve
// Base: /api/projects/:projectId/milestones/:milestoneId/approval/approve
router.post('/approve', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;

    // Only partner_poc may approve
    if (req.person.role !== 'partner_poc') {
      return res.status(404).json({ error: 'Not found' });
    }

    // Load milestone and verify it belongs to the project
    const milestoneResult = await query(
      'SELECT * FROM milestones WHERE id = $1 AND project_id = $2',
      [milestoneId, projectId]
    );
    if (!milestoneResult.rows.length) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    // Load approval for this milestone
    const approvalResult = await query(
      'SELECT * FROM approvals WHERE milestone_id = $1',
      [milestoneId]
    );
    if (!approvalResult.rows.length) {
      return res.status(404).json({ error: 'Approval record not found' });
    }
    const approval = approvalResult.rows[0];

    // With several POCs on a project, another POC may already have approved this milestone.
    if (approval.status === 'approved') {
      const by = approval.approved_by
        ? (await query('SELECT name FROM people WHERE id = $1', [approval.approved_by])).rows[0]?.name
        : null;
      return res.status(422).json({
        error: by ? `Already approved by ${by}.` : 'This milestone has already been approved.',
      });
    }

    // Check if user is POC on this project
    const pocResult = await query(
      "SELECT COUNT(*) FROM project_assignments WHERE project_id = $1 AND person_id = $2 AND assignment_role = 'poc'",
      [projectId, req.person.id]
    );
    const isPOCOnProject = parseInt(pocResult.rows[0].count, 10) > 0;

    // Load count of non-accepted delays for this milestone
    const delayCountResult = await query(
      "SELECT COUNT(*) FROM delays WHERE milestone_id = $1 AND status != 'accepted'",
      [milestoneId]
    );
    const pendingDelayCount = parseInt(delayCountResult.rows[0].count, 10);

    // Business rule check
    const ruleResult = canApprove(approval, pendingDelayCount, isPOCOnProject);
    if (!ruleResult.ok) {
      return res.status(422).json({ error: ruleResult.reason });
    }

    // Validate request body
    const { rating, comment } = req.body;

    if (rating === undefined || rating === null) {
      return res.status(422).json({ error: 'rating is required' });
    }
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(422).json({ error: 'rating must be an integer between 1 and 5' });
    }
    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(422).json({ error: 'comment is required and must not be empty' });
    }

    // Persist approval
    const updated = await query(
      `UPDATE approvals
       SET status = 'approved', approved_at = NOW(), approved_by = $1, rating = $2, comment = $3, updated_at = NOW()
       WHERE id = $4 AND status = 'pending'
       RETURNING *`,
      [req.person.id, ratingNum, comment.trim(), approval.id]
    );
    // Guards against two POCs approving concurrently: only the first write wins.
    if (!updated.rows.length) {
      return res.status(422).json({ error: 'This milestone has just been approved by another Partner POC.' });
    }
    const updatedApproval = { ...updated.rows[0], approved_by_name: req.person.name };

    // Audit
    await auditLog({ query }, {
      eventType: 'milestone_approved',
      entityType: 'approvals',
      entityId: approval.id,
      actorId: req.person.id,
      actorRole: req.person.role,
    });

    // Strip rating and comment — partner must not read feedback back per SPEC
    const { rating: _r, comment: _c, ...safeApproval } = updatedApproval;
    return res.json(safeApproval);
  } catch (err) {
    console.error('POST /approve error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /
// Base: /api/projects/:projectId/milestones/:milestoneId/approval
router.get('/', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;

    // Verify milestone belongs to project
    const milestoneResult = await query(
      'SELECT id FROM milestones WHERE id = $1 AND project_id = $2',
      [milestoneId, projectId]
    );
    if (!milestoneResult.rows.length) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    const approvalResult = await query(
      'SELECT * FROM approvals WHERE milestone_id = $1',
      [milestoneId]
    );
    if (!approvalResult.rows.length) {
      return res.status(404).json({ error: 'Approval not found' });
    }

    const approval = approvalResult.rows[0];

    // Admin sees full record; partner sees it without rating/comment
    if (req.person.role === 'admin') {
      return res.json(approval);
    }

    const { rating: _r, comment: _c, ...safeApproval } = approval;
    return res.json(safeApproval);
  } catch (err) {
    console.error('GET /approval error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
