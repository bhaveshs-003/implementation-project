import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { computeDashboard } from '../services/dashboardMetrics.js';

const router = Router();

// GET /api/dashboard
// Takes no parameters: scope comes from the signed-in person, never from the request.
router.get('/', requireAuth, async (req, res) => {
  try {
    res.json(await computeDashboard({ query }, req.person));
  } catch (err) {
    console.error('GET /dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
