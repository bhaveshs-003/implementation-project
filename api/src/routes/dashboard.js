import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { computeDashboard, RANGES } from '../services/dashboardMetrics.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/dashboard?range=all|quarter|month&partner=<person id>
// The role comes from the session. `partner` only narrows an admin's view; for a Partner POC it is
// ignored, so scope can never be widened or redirected from the request.
router.get('/', requireAuth, async (req, res) => {
  try {
    const range = RANGES.includes(req.query.range) ? req.query.range : 'all';
    const partnerId = typeof req.query.partner === 'string' && UUID_RE.test(req.query.partner) ? req.query.partner : null;
    res.json(await computeDashboard({ query }, req.person, { range, partnerId }));
  } catch (err) {
    console.error('GET /dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
