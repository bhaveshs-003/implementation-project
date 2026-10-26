import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { auditLog } from '../rules/rules.js';

const router = Router({ mergeParams: true });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 2000;

async function loadMilestone(milestoneId, projectId) {
  if (!UUID_RE.test(milestoneId)) return null;
  const r = await query('SELECT id FROM milestones WHERE id = $1 AND project_id = $2', [milestoneId, projectId]);
  return r.rows[0] || null;
}

// GET /api/projects/:projectId/milestones/:milestoneId/comments
router.get('/', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const ms = await loadMilestone(req.params.milestoneId, req.project.id);
    if (!ms) return res.status(404).json({ error: 'Milestone not found' });

    const result = await query(
      `SELECT c.id, c.milestone_id, c.sub_task_id, c.body, c.created_at, c.author_id,
              p.name AS author_name, p.role AS author_role
       FROM milestone_comments c JOIN people p ON p.id = c.author_id
       WHERE c.milestone_id = $1
       ORDER BY c.created_at, c.id`,
      [ms.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:projectId/milestones/:milestoneId/comments
// Admins and the project's Partner POCs can post at any time, on the milestone or one of its sub-tasks.
router.post('/', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const ms = await loadMilestone(req.params.milestoneId, req.project.id);
    if (!ms) return res.status(404).json({ error: 'Milestone not found' });

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(422).json({ error: 'A comment cannot be empty' });
    if (body.length > MAX_BODY) return res.status(422).json({ error: `A comment can be at most ${MAX_BODY} characters` });

    let subTaskId = req.body?.sub_task_id || null;
    if (subTaskId) {
      if (!UUID_RE.test(subTaskId)) return res.status(422).json({ error: 'Invalid sub-task' });
      const st = await query('SELECT id FROM sub_tasks WHERE id = $1 AND milestone_id = $2', [subTaskId, ms.id]);
      if (!st.rows.length) return res.status(422).json({ error: 'Sub-task does not belong to this milestone' });
    }

    const inserted = await query(
      `INSERT INTO milestone_comments (milestone_id, sub_task_id, author_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id, milestone_id, sub_task_id, body, created_at, author_id`,
      [ms.id, subTaskId, req.person.id, body]
    );
    const comment = { ...inserted.rows[0], author_name: req.person.name, author_role: req.person.role };

    await auditLog({ query }, {
      eventType: 'comment_posted', entityType: 'milestones', entityId: ms.id,
      actorId: req.person.id, actorRole: req.person.role, meta: { comment_id: comment.id, sub_task_id: subTaskId },
    });
    res.status(201).json(comment);
  } catch (err) {
    console.error('POST /comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
