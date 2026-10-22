import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { checkRateLimit, recordAttempt } from '../middleware/rateLimit.js';
import { auditLog } from '../rules/rules.js';

const router = Router();

const COOKIE_OPTS = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge,
});

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '0.0.0.0';
}

async function supabaseAuth(path, body, serviceKey = false) {
  const key = serviceKey ? process.env.SUPABASE_SERVICE_KEY : process.env.SUPABASE_ANON_KEY;
  return fetch(`${process.env.SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

async function supabaseAdmin(method, path, body) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${process.env.SUPABASE_URL}/auth/v1/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const ip = getIP(req);
    const { limited, retryAfter } = await checkRateLimit(email, ip);
    if (limited) return res.status(429).json({ error: 'Too many attempts', retryAfter });

    const authRes = await supabaseAuth('/token?grant_type=password', { email, password });
    if (!authRes.ok) {
      await recordAttempt(email, ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { access_token, refresh_token, user } = await authRes.json();
    const personRes = await query(
      'SELECT id, name, email, role, user_id FROM people WHERE email = $1',
      [user.email]
    );
    if (!personRes.rows.length) {
      return res.status(401).json({ error: 'Account not found' });
    }
    // Sync real Supabase UID on first login (seed uses placeholder UIDs)
    if (personRes.rows[0].user_id !== user.id) {
      await query('UPDATE people SET user_id = $1 WHERE id = $2', [user.id, personRes.rows[0].id]);
    }

    res.cookie('access_token', access_token, COOKIE_OPTS(3600 * 1000));
    res.cookie('refresh_token', refresh_token, COOKIE_OPTS(7 * 24 * 3600 * 1000));
    res.json({ person: personRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/signout', requireAuth, async (req, res) => {
  try {
    const token = req.cookies?.access_token;
    if (token) {
      await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      });
    }
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    supabaseAuth('/recover', { email }).catch(() => {});
  }
  res.json({ message: 'If that address exists, a reset link has been sent' });
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token_hash, new_password } = req.body || {};
    if (!token_hash) return res.status(400).json({ error: 'token_hash required' });
    if (!new_password || new_password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters' });
    }

    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ type: 'recovery', token_hash }),
    });
    if (!verifyRes.ok) return res.status(400).json({ error: 'Invalid or expired reset link' });

    const { access_token, refresh_token, user } = await verifyRes.json();
    const personRes = await query(
      'SELECT id, name, email, role, user_id FROM people WHERE email = $1',
      [user.email]
    );
    if (!personRes.rows.length) return res.status(400).json({ error: 'Account not found' });
    if (personRes.rows[0].user_id !== user.id) {
      await query('UPDATE people SET user_id = $1 WHERE id = $2', [user.id, personRes.rows[0].id]);
    }

    res.cookie('access_token', access_token, COOKIE_OPTS(3600 * 1000));
    res.cookie('refresh_token', refresh_token, COOKIE_OPTS(7 * 24 * 3600 * 1000));
    res.json({ person: personRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || new_password.length < 10) {
      return res.status(400).json({ error: 'New password must be at least 10 characters' });
    }

    const reAuthRes = await supabaseAuth('/token?grant_type=password', {
      email: req.person.email,
      password: current_password,
    });
    if (!reAuthRes.ok) return res.status(401).json({ error: 'Current password is incorrect' });
    const { access_token: newAt, refresh_token: newRt } = await reAuthRes.json();

    await supabaseAdmin('PUT', `/users/${req.supabaseUserId}`, { password: new_password });

    // Sign out all other sessions by revoking via admin
    await supabaseAdmin('DELETE', `/users/${req.supabaseUserId}/sessions`, null);

    res.cookie('access_token', newAt, COOKIE_OPTS(3600 * 1000));
    res.cookie('refresh_token', newRt, COOKIE_OPTS(7 * 24 * 3600 * 1000));

    await auditLog(
      { query: (sql, params) => query(sql, params) },
      { eventType: 'password_change', entityType: 'people', entityId: req.person.id, actorId: req.person.id, actorRole: req.person.role }
    );

    res.json({ message: 'Password changed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ person: req.person });
});

export default router;
