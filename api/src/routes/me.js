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

      const rejectedResult = await query(
        `SELECT COUNT(*)::int AS n
         FROM approvals a
         JOIN milestones m ON m.id = a.milestone_id
         JOIN projects p ON p.id = m.project_id
         WHERE p.deleted_at IS NULL AND a.status = 'rejected'`
      );
      const rejectedCount = rejectedResult.rows[0].n;
      if (rejectedCount > 0) {
        items.push({
          type: 'rejected_approvals',
          count: rejectedCount,
          label: `approval${rejectedCount > 1 ? 's' : ''} denied by the partner`,
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
      // One item per action, each linking straight to where it is resolved.
      const [newRes, approvalRes, delayRes] = await Promise.all([
        query(
          `SELECT p.id AS project_id, p.code, p.title
           FROM project_assignments pa JOIN projects p ON p.id = pa.project_id
           WHERE p.deleted_at IS NULL AND pa.person_id = $1
             AND pa.assignment_role = 'poc' AND pa.seen_at IS NULL
           ORDER BY pa.assigned_at DESC`,
          [person.id]
        ),
        query(
          `SELECT a.status, m.id AS milestone_id, m.title AS milestone_title, p.id AS project_id, p.code
           FROM approvals a
           JOIN milestones m ON m.id = a.milestone_id
           JOIN projects p ON p.id = m.project_id
           JOIN project_assignments pa ON pa.project_id = p.id AND pa.person_id = $1 AND pa.assignment_role = 'poc'
           WHERE p.deleted_at IS NULL AND a.status = 'pending'
           ORDER BY a.submitted_at`,
          [person.id]
        ),
        query(
          `SELECT d.id AS delay_id, d.status, m.id AS milestone_id, m.title AS milestone_title, p.id AS project_id, p.code
           FROM delays d
           JOIN milestones m ON m.id = d.milestone_id
           JOIN projects p ON p.id = m.project_id
           JOIN project_assignments pa ON pa.project_id = p.id AND pa.person_id = $1 AND pa.assignment_role = 'poc'
           WHERE p.deleted_at IS NULL
             AND (d.status = 'pending'
                  OR (d.status = 'denied' AND ${LAST_AUTHOR_ROLE} = 'admin'))
           ORDER BY d.created_at`,
          [person.id]
        ),
      ]);

      for (const r of newRes.rows) {
        items.push({
          type: 'new_assignment', count: 1,
          label: 'New project assigned to you',
          detail: `${r.code} · ${r.title}`,
          link: `/projects/${r.project_id}`,
        });
      }
      for (const r of approvalRes.rows) {
        items.push({
          type: 'pending_approval', count: 1,
          label: 'Milestone awaiting your approval',
          detail: `${r.code} · ${r.milestone_title}`,
          link: `/projects/${r.project_id}`,
        });
      }
      for (const r of delayRes.rows) {
        items.push({
          type: 'pending_delay', count: 1,
          label: r.status === 'pending' ? 'Delay awaiting your decision' : 'Admin replied to your denied delay',
          detail: `${r.code} · ${r.milestone_title}`,
          link: `/projects/${r.project_id}`,
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
