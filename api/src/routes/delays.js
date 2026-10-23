import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveProjectScope } from '../middleware/scope.js';
import { canAcceptDelay, canDenyDelay, canReplyToDelay, canCloseDelay, auditLog } from '../rules/rules.js';

const router = Router({ mergeParams: true });

// Helper: verify caller is POC on the given project
async function assertPOCOnProject(projectId, personId, res) {
  const pocResult = await query(
    "SELECT COUNT(*) FROM project_assignments WHERE project_id = $1 AND person_id = $2 AND assignment_role = 'poc'",
    [projectId, personId]
  );
  if (parseInt(pocResult.rows[0].count, 10) === 0) {
    res.status(403).json({ error: 'Not a POC on this project' });
    return false;
  }
  return true;
}

// Helper: load a delay scoped to a project (404 if not found / wrong project)
async function loadScopedDelay(delayId, projectId) {
  const result = await query(
    `SELECT d.*
     FROM delays d
     JOIN milestones m ON m.id = d.milestone_id
     WHERE d.id = $1 AND m.project_id = $2`,
    [delayId, projectId]
  );
  return result.rows[0] || null;
}

// GET /
// Base: /api/projects/:projectId/delays
router.get('/', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId } = req.params;

    // ONE query: all delays for this project with milestone + subtask titles
    const delaysResult = await query(
      `SELECT d.*, m.title AS milestone_title, st.title AS subtask_title
       FROM delays d
       JOIN milestones m ON m.id = d.milestone_id
       LEFT JOIN sub_tasks st ON st.id = d.sub_task_id
       WHERE m.project_id = $1
       ORDER BY d.created_at`,
      [projectId]
    );
    const delays = delaysResult.rows;

    if (!delays.length) {
      return res.json([]);
    }

    const delayIds = delays.map((d) => d.id);

    // ONE query: all messages for those delays
    const messagesResult = await query(
      `SELECT dm.*, p.name AS author_name, p.role AS author_role
       FROM delay_messages dm
       JOIN people p ON p.id = dm.author_id
       WHERE dm.delay_id = ANY($1::uuid[])
       ORDER BY dm.created_at`,
      [delayIds]
    );
    const messages = messagesResult.rows;

    // ONE query: all attachments referenced by those messages
    const attachmentIds = messages.map((m) => m.attachment_id).filter(Boolean);
    let attachmentMap = {};
    if (attachmentIds.length) {
      const attachmentsResult = await query(
        'SELECT * FROM attachments WHERE id = ANY($1::uuid[])',
        [attachmentIds]
      );
      attachmentMap = Object.fromEntries(
        attachmentsResult.rows.map((a) => [a.id, a])
      );
    }

    // Assemble messages (with embedded attachment) keyed by delay_id
    const messagesByDelay = {};
    for (const msg of messages) {
      if (!messagesByDelay[msg.delay_id]) {
        messagesByDelay[msg.delay_id] = [];
      }
      const enriched = { ...msg };
      if (enriched.attachment_id && attachmentMap[enriched.attachment_id]) {
        enriched.attachment = attachmentMap[enriched.attachment_id];
      }
      messagesByDelay[msg.delay_id].push(enriched);
    }

    // Group delays by milestone
    const grouped = new Map();
    for (const d of delays) {
      const key = d.milestone_id;
      if (!grouped.has(key)) {
        grouped.set(key, {
          milestone_id: key,
          milestone_title: d.milestone_title,
          delays: [],
        });
      }
      // milestone_title is represented at the group level — exclude from individual delay
      const { milestone_title: _mt, ...delayData } = d;
      grouped.get(key).delays.push({
        ...delayData,
        messages: messagesByDelay[d.id] || [],
      });
    }

    return res.json(Array.from(grouped.values()));
  } catch (err) {
    console.error('GET /delays error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:delayId/accept
router.post('/:delayId/accept', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, delayId } = req.params;

    const delay = await loadScopedDelay(delayId, projectId);
    if (!delay) {
      return res.status(404).json({ error: 'Delay not found' });
    }

    const ruleResult = canAcceptDelay(delay, req.person);
    if (!ruleResult.ok) {
      return res.status(422).json({ error: ruleResult.reason });
    }

    if (req.person.role === 'partner_poc') {
      const ok = await assertPOCOnProject(projectId, req.person.id, res);
      if (!ok) return;
    }

    await query(
      "UPDATE delays SET status = 'accepted', decided_at = NOW(), decided_by = $1 WHERE id = $2",
      [req.person.id, delayId]
    );

    await query(
      "INSERT INTO delay_messages (delay_id, author_id, body, action) VALUES ($1, $2, 'Accepted', 'accept')",
      [delayId, req.person.id]
    );

    await auditLog({ query }, {
      eventType: 'delay_accepted',
      entityType: 'delays',
      entityId: delayId,
      actorId: req.person.id,
      actorRole: req.person.role,
    });

    const updated = await query('SELECT * FROM delays WHERE id = $1', [delayId]);
    return res.json(updated.rows[0]);
  } catch (err) {
    console.error('POST /:delayId/accept error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:delayId/deny
router.post('/:delayId/deny', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, delayId } = req.params;

    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(422).json({ error: 'reason is required and must not be empty' });
    }

    const delay = await loadScopedDelay(delayId, projectId);
    if (!delay) {
      return res.status(404).json({ error: 'Delay not found' });
    }

    const ruleResult = canDenyDelay(delay, req.person);
    if (!ruleResult.ok) {
      return res.status(422).json({ error: ruleResult.reason });
    }

    if (req.person.role === 'partner_poc') {
      const ok = await assertPOCOnProject(projectId, req.person.id, res);
      if (!ok) return;
    }

    await query(
      "UPDATE delays SET status = 'denied', decided_at = NOW(), decided_by = $1 WHERE id = $2",
      [req.person.id, delayId]
    );

    await query(
      "INSERT INTO delay_messages (delay_id, author_id, body, action) VALUES ($1, $2, $3, 'deny')",
      [delayId, req.person.id, reason.trim()]
    );

    await auditLog({ query }, {
      eventType: 'delay_denied',
      entityType: 'delays',
      entityId: delayId,
      actorId: req.person.id,
      actorRole: req.person.role,
    });

    const updated = await query('SELECT * FROM delays WHERE id = $1', [delayId]);
    return res.json(updated.rows[0]);
  } catch (err) {
    console.error('POST /:delayId/deny error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:delayId/reply
router.post('/:delayId/reply', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, delayId } = req.params;

    const { body, attachment_id } = req.body;
    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(422).json({ error: 'body is required and must not be empty' });
    }

    const delay = await loadScopedDelay(delayId, projectId);
    if (!delay) {
      return res.status(404).json({ error: 'Delay not found' });
    }

    const ruleResult = canReplyToDelay(delay, req.person);
    if (!ruleResult.ok) {
      return res.status(422).json({ error: ruleResult.reason });
    }

    // Admin may only reply to denied threads
    if (req.person.role === 'admin' && delay.status !== 'denied') {
      return res.status(422).json({ error: 'Admins can only reply on denied delay threads' });
    }

    // Partner POC must be assigned as POC on this project
    if (req.person.role === 'partner_poc') {
      const ok = await assertPOCOnProject(projectId, req.person.id, res);
      if (!ok) return;
    }

    // Validate attachment ownership if provided
    let attachmentId = null;
    if (attachment_id) {
      const attachmentResult = await query(
        'SELECT * FROM attachments WHERE id = $1 AND created_by = $2 AND claimed = false',
        [attachment_id, req.person.id]
      );
      if (!attachmentResult.rows.length) {
        return res.status(404).json({ error: 'Attachment not found or already claimed' });
      }
      attachmentId = attachment_id;
    }

    // Insert message
    const msgResult = await query(
      `INSERT INTO delay_messages (delay_id, author_id, body, action, attachment_id)
       VALUES ($1, $2, $3, NULL, $4)
       RETURNING *`,
      [delayId, req.person.id, body.trim(), attachmentId]
    );
    const message = msgResult.rows[0];

    // Claim the attachment now that the message exists
    if (attachmentId) {
      await query(
        'UPDATE attachments SET claimed = true, claimed_at = NOW(), claimed_by_message_id = $1 WHERE id = $2',
        [message.id, attachmentId]
      );
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error('POST /:delayId/reply error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:delayId/close  (admin only — force-accepts a denied thread)
router.post('/:delayId/close', requireAuth, resolveProjectScope, async (req, res) => {
  try {
    const { projectId, delayId } = req.params;

    const delay = await loadScopedDelay(delayId, projectId);
    if (!delay) return res.status(404).json({ error: 'Delay not found' });

    const ruleResult = canCloseDelay(delay, req.person);
    if (!ruleResult.ok) return res.status(422).json({ error: ruleResult.reason });

    await query(
      "UPDATE delays SET status = 'accepted', decided_at = NOW(), decided_by = $1 WHERE id = $2",
      [req.person.id, delayId]
    );
    await query(
      "INSERT INTO delay_messages (delay_id, author_id, body, action) VALUES ($1, $2, 'Thread closed by admin.', 'accept')",
      [delayId, req.person.id]
    );
    await auditLog({ query }, {
      eventType: 'delay_closed',
      entityType: 'delays',
      entityId: delayId,
      actorId: req.person.id,
      actorRole: req.person.role,
    });

    const updated = await query('SELECT * FROM delays WHERE id = $1', [delayId]);
    return res.json(updated.rows[0]);
  } catch (err) {
    console.error('POST /:delayId/close error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
