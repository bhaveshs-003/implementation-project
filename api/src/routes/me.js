import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const LAST_AUTHOR_ROLE = `(
  SELECT pe.role FROM delay_messages dm JOIN people pe ON pe.id = dm.author_id
  WHERE dm.delay_id = d.id ORDER BY dm.created_at DESC LIMIT 1
)`;

// GET /api/me/pending
// Returns pending-action counts tailored to the current user's role.
router.get('/pending', requireAuth, async (req, res) => {
  try {
    const person = req.person;
    const items = [];

    if (person.role === 'admin') {
      // Milestones completed but not yet submitted for approval
      const submitResult = await query(
        `SELECT COUNT(*)::int AS n
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         LEFT JOIN approvals a ON a.milestone_id = m.id
         WHERE p.deleted_at IS NULL
           AND p.status != 'completed'
           AND m.status = 'completed'
           AND a.id IS NULL`
      );
      const submitCount = submitResult.rows[0].n;
      if (submitCount > 0) {
        items.push({
          type: 'submit_approval',
          count: submitCount,
          label: `milestone${submitCount > 1 ? 's' : ''} ready to submit for approval`,
          link: '/projects',
        });
      }

      // Denied delay threads awaiting admin response
      const deniedResult = await query(
        `SELECT COUNT(*)::int AS n
         FROM delays d
         JOIN milestones m ON m.id = d.milestone_id
         JOIN projects p ON p.id = m.project_id
         WHERE p.deleted_at IS NULL
           AND d.status = 'denied'
           AND COALESCE(${LAST_AUTHOR_ROLE}, '') <> 'admin'`
      );
      const deniedCount = deniedResult.rows[0].n;
      if (deniedCount > 0) {
        items.push({
          type: 'denied_threads',
          count: deniedCount,
          label: `denied delay thread${deniedCount > 1 ? 's' : ''} needing your response`,
          link: '/projects',
        });
      }
    } else if (person.role === 'partner_poc') {
      const newResult = await query(
        `SELECT COUNT(*)::int AS n
         FROM project_assignments pa
         JOIN projects p ON p.id = pa.project_id
         WHERE p.deleted_at IS NULL AND pa.person_id = $1
           AND pa.assignment_role = 'poc' AND pa.seen_at IS NULL`,
        [person.id]
      );
      const newCount = newResult.rows[0].n;
      if (newCount > 0) {
        items.push({
          type: 'new_assignments',
          count: newCount,
          label: `new project${newCount > 1 ? 's' : ''} assigned to you`,
          link: '/projects',
        });
      }

      // Milestone approvals pending this partner's sign-off
      const approvalResult = await query(
        `SELECT COUNT(*)::int AS n
         FROM approvals a
         JOIN milestones m ON m.id = a.milestone_id
         JOIN projects p ON p.id = m.project_id
         JOIN project_assignments pa
           ON pa.project_id = p.id
           AND pa.person_id = $1
           AND pa.assignment_role = 'poc'
         WHERE p.deleted_at IS NULL
           AND a.status = 'pending'`,
        [person.id]
      );
      const approvalCount = approvalResult.rows[0].n;
      if (approvalCount > 0) {
        items.push({
          type: 'pending_approvals',
          count: approvalCount,
          label: `milestone${approvalCount > 1 ? 's' : ''} awaiting your approval`,
          link: '/projects',
        });
      }

      // Delay threads pending this partner's accept/deny decision
      const delayResult = await query(
        `SELECT COUNT(*)::int AS n
         FROM delays d
         JOIN milestones m ON m.id = d.milestone_id
         JOIN projects p ON p.id = m.project_id
         JOIN project_assignments pa
           ON pa.project_id = p.id
           AND pa.person_id = $1
           AND pa.assignment_role = 'poc'
         WHERE p.deleted_at IS NULL
           AND (d.status = 'pending'
                OR (d.status = 'denied' AND ${LAST_AUTHOR_ROLE} = 'admin'))`,
        [person.id]
      );
      const delayCount = delayResult.rows[0].n;
      if (delayCount > 0) {
        items.push({
          type: 'pending_delays',
          count: delayCount,
          label: `delay thread${delayCount > 1 ? 's' : ''} awaiting your response`,
          link: '/projects',
        });
      }
    }

    const total = items.reduce((s, i) => s + i.count, 0);
    return res.json({ total, items });
  } catch (err) {
    console.error('GET /me/pending error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
