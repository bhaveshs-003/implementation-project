import { query } from '../db/pool.js';

// Postgres-backed rate limiter.
// Two budgets: 6 failures per email, 40 per IP in 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 6;
const MAX_PER_IP = 40;

export async function recordAttempt(email, ip) {
  await query(
    `INSERT INTO rate_limit_attempts (email, ip, attempted_at) VALUES ($1, $2, NOW())`,
    [email || null, ip]
  );
}

export async function checkRateLimit(email, ip) {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const [emailRes, ipRes] = await Promise.all([
    email
      ? query(
          `SELECT COUNT(*)::int AS cnt FROM rate_limit_attempts WHERE email = $1 AND attempted_at > $2`,
          [email, windowStart]
        )
      : Promise.resolve({ rows: [{ cnt: 0 }] }),
    query(
      `SELECT COUNT(*)::int AS cnt FROM rate_limit_attempts WHERE ip = $1 AND attempted_at > $2`,
      [ip, windowStart]
    ),
  ]);

  const emailCount = emailRes.rows[0].cnt;
  const ipCount = ipRes.rows[0].cnt;

  if (emailCount >= MAX_PER_EMAIL || ipCount >= MAX_PER_IP) {
    return { limited: true, retryAfter: 900 };
  }
  return { limited: false };
}

// Prune old rate limit rows (called by cron).
export async function pruneRateLimits() {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const res = await query(
    `DELETE FROM rate_limit_attempts WHERE attempted_at < $1`,
    [cutoff]
  );
  return res.rowCount;
}
