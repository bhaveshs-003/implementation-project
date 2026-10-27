import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { canApprove, canRejectApproval, canOverrideApproval, auditLog } from '../rules/rules.js';

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
       WHERE id = $4 AND status IN ('pending', 'rejected')
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

async function isPocOnProject(projectId, personId) {
  const r = await query(
    "SELECT COUNT(*)::int AS n FROM project_assignments WHERE project_id = $1 AND person_id = $2 AND assignment_role = 'poc'",
    [projectId, personId]
  );
  return r.rows[0].n > 0;
}

const MAX_REASON = 1900;

// Mirrors approval decisions into the milestone conversation so the full back-and-forth reads in one place.
async function postApprovalComment(milestoneId, authorId, body) {
  try {
    await query(
      'INSERT INTO milestone_comments (milestone_id, author_id, body) VALUES ($1, $2, $3)',
      [milestoneId, authorId, body]
    );
  } catch (err) {
    console.error('postApprovalComment failed:', err);
  }
}

async function loadApproval(milestoneId, projectId) {
  const r = await query(
    `SELECT a.* FROM approvals a JOIN milestones m ON m.id = a.milestone_id
     WHERE a.milestone_id = $1 AND m.project_id = $2`,
    [milestoneId, projectId]
  );
  return r.rows[0] || null;
}

// POST /reject  (partner POC denies the approval, even when the milestone was on time)
router.post('/reject', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;
    if (req.person.role !== 'partner_poc') return res.status(404).json({ error: 'Not found' });

    const approval = await loadApproval(milestoneId, projectId);
    if (!approval) return res.status(404).json({ error: 'Approval record not found' });

    const rule = canRejectApproval(approval, await isPocOnProject(projectId, req.person.id));
    if (!rule.ok) return res.status(422).json({ error: rule.reason });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(422).json({ error: 'A reason is required to deny an approval' });
    if (reason.length > MAX_REASON) return res.status(422).json({ error: `Reason can be at most ${MAX_REASON} characters` });

    const updated = await query(
      `UPDATE approvals SET status = 'rejected', rejected_at = NOW(), rejected_by = $1,
         rejection_reason = $2, updated_at = NOW()
       WHERE id = $3 AND status IN ('pending', 'rejected') RETURNING *`,
      [req.person.id, reason, approval.id]
    );
    if (!updated.rows.length) return res.status(422).json({ error: 'This approval was just actioned by someone else.' });
    await postApprovalComment(milestoneId, req.person.id, `Approval denied: ${reason}`);

    await auditLog({ query }, {
      eventType: 'approval_rejected', entityType: 'approvals', entityId: approval.id,
      actorId: req.person.id, actorRole: req.person.role, meta: { reason },
    });
    const { rating: _r, comment: _c, ...safe } = { ...updated.rows[0], rejected_by_name: req.person.name };
    return res.json(safe);
  } catch (err) {
    console.error('POST /reject error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /override  (admin approves on the partner's behalf at any point before it is approved)
router.post('/override', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;
    const msRes = await query('SELECT * FROM milestones WHERE id = $1 AND project_id = $2', [milestoneId, projectId]);
    if (!msRes.rows.length) return res.status(404).json({ error: 'Milestone not found' });
    const approval = await loadApproval(milestoneId, projectId);

    const rule = canOverrideApproval(approval, req.person, msRes.rows[0]);
    if (!rule.ok) return res.status(422).json({ error: rule.reason });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 5) return res.status(422).json({ error: 'A reason of at least 5 characters is required to override' });
    if (reason.length > MAX_REASON) return res.status(422).json({ error: `Reason can be at most ${MAX_REASON} characters` });

    const updated = approval
      ? await query(
          `UPDATE approvals SET status = 'approved', approved_at = NOW(), approved_by = $1,
             overridden_by = $1, override_reason = $2, updated_at = NOW()
           WHERE id = $3 AND status <> 'approved' RETURNING *`,
          [req.person.id, reason, approval.id]
        )
      : await query(
          `INSERT INTO approvals (milestone_id, status, submitted_at, submitted_by, approved_at, approved_by, overridden_by, override_reason)
           VALUES ($1, 'approved', NOW(), $2, NOW(), $2, $2, $3) RETURNING *`,
          [milestoneId, req.person.id, reason]
        );
    if (!updated.rows.length) return res.status(422).json({ error: 'Already approved' });

    await postApprovalComment(milestoneId, req.person.id, `Approved by admin override: ${reason}`);
    await auditLog({ query }, {
      eventType: 'approval_overridden', entityType: 'approvals', entityId: updated.rows[0].id,
      actorId: req.person.id, actorRole: req.person.role,
      oldValues: { status: approval?.status ?? 'none' }, meta: { reason },
    });
    return res.json({ ...updated.rows[0], approved_by_name: req.person.name });
  } catch (err) {
    console.error('POST /override error:', err);
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
