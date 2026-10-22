import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../rules/rules.js';

const router = Router();

function supabaseAdmin(method, path, body) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${process.env.SUPABASE_URL}/auth/v1/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, job_title, role FROM people ORDER BY name');
    const resources = result.rows.filter(p => p.role === 'resource');
    const partnerPocs = result.rows.filter(p => p.role === 'partner_poc');
    const admins = result.rows.filter(p => p.role === 'admin');
    res.json({ resources, partnerPocs, admins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resources', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, job_title } = req.body || {};
    if (!name || name.trim().length < 2) return res.status(422).json({ error: 'name must be at least 2 characters' });

    const result = await query(
      `INSERT INTO people (name, job_title, role) VALUES ($1,$2,'resource') RETURNING id, name, job_title, role`,
      [name.trim(), job_title || null]
    );
    await auditLog({ query }, { eventType: 'resource_created', entityType: 'people', entityId: result.rows[0].id, actorId: req.person.id, actorRole: req.person.role, newValues: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/partner-pocs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || name.trim().length < 2) return res.status(422).json({ error: 'name required' });
    if (!email || !isValidEmail(email)) return res.status(422).json({ error: 'Valid email required' });
    if (!password || password.length < 10) return res.status(422).json({ error: 'Password must be at least 10 characters' });

    // Step 1: Create Supabase Auth user
    const authRes = await supabaseAdmin('POST', '/users', { email, password, email_confirm: true });
    if (!authRes.ok) {
      const body = await authRes.json();
      return res.status(422).json({ error: body.message || 'Failed to create auth user' });
    }
    const supaUser = await authRes.json();

    // Step 2: Insert people row
    try {
      const result = await query(
        `INSERT INTO people (name, email, role, user_id) VALUES ($1,$2,'partner_poc',$3) RETURNING id, name, email, role`,
        [name.trim(), email, supaUser.id]
      );
      await auditLog({ query }, { eventType: 'partner_poc_created', entityType: 'people', entityId: result.rows[0].id, actorId: req.person.id, actorRole: req.person.role, newValues: result.rows[0] });
      res.status(201).json(result.rows[0]);
    } catch (dbErr) {
      // Rollback: delete auth user
      await supabaseAdmin('DELETE', `/users/${supaUser.id}`, undefined);
      throw dbErr;
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, job_title, role FROM people WHERE id=$1', [req.person.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Person not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/me', requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (name !== undefined && name.trim().length < 2) return res.status(422).json({ error: 'Name must be at least 2 characters' });
    if (email !== undefined && !isValidEmail(email)) return res.status(422).json({ error: 'Invalid email address' });

    const old = (await query('SELECT * FROM people WHERE id=$1', [req.person.id])).rows[0];

    if (email && email !== old.email && old.user_id) {
      const authRes = await supabaseAdmin('PUT', `/users/${old.user_id}`, { email });
      if (!authRes.ok) {
        const body = await authRes.json();
        return res.status(422).json({ error: body.message || 'Failed to update email in auth' });
      }
    }

    const result = await query(
      `UPDATE people SET name=COALESCE($1,name), email=COALESCE($2,email), updated_at=NOW() WHERE id=$3 RETURNING id, name, email, job_title, role`,
      [name?.trim() || null, email || null, req.person.id]
    );
    await auditLog({ query }, { eventType: 'profile_updated', entityType: 'people', entityId: req.person.id, actorId: req.person.id, actorRole: req.person.role, oldValues: { name: old.name, email: old.email }, newValues: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const personRes = await query('SELECT * FROM people WHERE id=$1', [req.params.id]);
    if (!personRes.rows.length) return res.status(404).json({ error: 'Person not found' });
    const old = personRes.rows[0];

    const { name, email, job_title, password } = req.body || {};
    if (name && name.trim().length < 2) return res.status(422).json({ error: 'name too short' });
    if (email && !isValidEmail(email)) return res.status(422).json({ error: 'Invalid email' });
    if (password) {
      if (password.length < 10) return res.status(422).json({ error: 'Password must be at least 10 characters' });
      if (!old.user_id) return res.status(422).json({ error: 'Cannot set password for a resource without a login' });
      await supabaseAdmin('PUT', `/users/${old.user_id}`, { password });
    }

    const result = await query(
      `UPDATE people SET name=COALESCE($1,name), email=COALESCE($2,email), job_title=COALESCE($3,job_title), updated_at=NOW()
       WHERE id=$4 RETURNING id, name, email, job_title, role`,
      [name?.trim(), email, job_title, req.params.id]
    );
    await auditLog({ query }, { eventType: 'person_updated', entityType: 'people', entityId: req.params.id, actorId: req.person.id, actorRole: req.person.role, oldValues: old, newValues: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.person.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const personRes = await query('SELECT * FROM people WHERE id=$1', [req.params.id]);
    if (!personRes.rows.length) return res.status(404).json({ error: 'Person not found' });
    const person = personRes.rows[0];

    // Remove login first (partial failure leaves user unable to sign in)
    if (person.user_id) {
      await supabaseAdmin('DELETE', `/users/${person.user_id}`, undefined);
    }

    const countRes = await query('SELECT COUNT(*)::int AS cnt FROM project_assignments WHERE person_id=$1', [req.params.id]);
    const projectsUnassigned = countRes.rows[0].cnt;

    await query('DELETE FROM project_assignments WHERE person_id=$1', [req.params.id]);
    await query('DELETE FROM people WHERE id=$1', [req.params.id]);

    await auditLog({ query }, { eventType: 'person_deleted', entityType: 'people', entityId: req.params.id, actorId: req.person.id, actorRole: req.person.role, meta: { projects_unassigned: projectsUnassigned } });
    res.json({ message: 'Deleted', projectsUnassigned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
