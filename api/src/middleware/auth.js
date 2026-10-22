import { query } from '../db/pool.js';

async function getSupabaseUser(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken) {
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function requireAuth(req, res, next) {
  let accessToken = req.cookies?.access_token;
  const refreshToken = req.cookies?.refresh_token;

  if (!accessToken && !refreshToken) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  let supabaseUser = await getSupabaseUser(accessToken);

  if (!supabaseUser) {
    if (!refreshToken) return res.status(401).json({ error: 'Session expired' });

    const fresh = await refreshAccessToken(refreshToken);
    if (!fresh?.access_token) return res.status(401).json({ error: 'Session expired' });

    accessToken = fresh.access_token;
    res.cookie('access_token', fresh.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600 * 1000,
    });
    if (fresh.refresh_token) {
      res.cookie('refresh_token', fresh.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 3600 * 1000,
      });
    }

    supabaseUser = await getSupabaseUser(accessToken);
    if (!supabaseUser) return res.status(401).json({ error: 'Session expired' });
  }

  const personRes = await query(
    `SELECT id, name, email, role, user_id FROM people WHERE user_id = $1`,
    [supabaseUser.id]
  );

  if (personRes.rows.length === 0) {
    return res.status(401).json({ error: 'Account not found' });
  }

  req.person = personRes.rows[0];
  req.supabaseUserId = supabaseUser.id;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.person?.role !== 'admin') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

export function requirePartner(req, res, next) {
  if (req.person?.role !== 'partner_poc') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}
