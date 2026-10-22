import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { canCompleteSubTask, auditLog } from '../rules/rules.js';

const router = Router({ mergeParams: true });

async function loadSubtaskOwned(subtaskId, milestoneId, projectId) {
  const res = await query(
    `SELECT st.* FROM sub_tasks st
     JOIN milestones m ON m.id = st.milestone_id
     WHERE st.id = $1 AND m.id = $2 AND m.project_id = $3`,
    [subtaskId, milestoneId, projectId]
  );
  return res.rows[0] || null;
}

router.post('/', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const ms = await query('SELECT * FROM milestones WHERE id=$1 AND project_id=$2', [req.params.milestoneId, req.project.id]);
    if (!ms.rows.length) return res.status(404).json({ error: 'Milestone not found' });
    if (ms.rows[0].status === 'completed') return res.status(422).json({ error: 'Milestone is completed' });

    const { title, order_index } = req.body || {};
    if (!title) return res.status(422).json({ error: 'title required' });

    const maxIdx = await query('SELECT COALESCE(MAX(order_index),0)+1 AS next FROM sub_tasks WHERE milestone_id=$1', [req.params.milestoneId]);
    const result = await query(
      `INSERT INTO sub_tasks (milestone_id, title, status, order_index) VALUES ($1,$2,'open',$3) RETURNING *`,
      [req.params.milestoneId, title, order_index ?? maxIdx.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:subtaskId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const st = await loadSubtaskOwned(req.params.subtaskId, req.params.milestoneId, req.params.projectId);
    if (!st) return res.status(404).json({ error: 'Sub-task not found' });

    const { title, order_index } = req.body || {};
    const result = await query(
      `UPDATE sub_tasks SET title=COALESCE($1,title), order_index=COALESCE($2,order_index), updated_at=NOW() WHERE id=$3 RETURNING *`,
      [title, order_index, req.params.subtaskId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:subtaskId/complete', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const st = await loadSubtaskOwned(req.params.subtaskId, req.params.milestoneId, req.project.id);
    if (!st) return res.status(404).json({ error: 'Sub-task not found' });

    const { ok, reason } = canCompleteSubTask(st, req.project);
    if (!ok) return res.status(422).json({ error: reason });

    const result = await query(
      `UPDATE sub_tasks SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.subtaskId]
    );
    await auditLog({ query }, { eventType: 'subtask_completed', entityType: 'sub_tasks', entityId: req.params.subtaskId, actorId: req.person.id, actorRole: req.person.role });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:subtaskId', requireAuth, requireAdmin, resolveProjectScope, async (req, res) => {
  try {
    const st = await loadSubtaskOwned(req.params.subtaskId, req.params.milestoneId, req.params.projectId);
    if (!st) return res.status(404).json({ error: 'Sub-task not found' });
    await query('DELETE FROM sub_tasks WHERE id=$1', [req.params.subtaskId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
