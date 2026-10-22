import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Whitelist to prevent ORDER BY injection
const ALLOWED_SORT_FIELDS = new Set(['created_at', 'event_type', 'entity_type', 'actor_id']);

// GET /
// Base: /api/audit
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      q,
      category,
      sort = 'created_at',
      order = 'desc',
      page = '1',
      limit: limitParam = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50));
    const offset = (pageNum - 1) * limit;

    const sortField = ALLOWED_SORT_FIELDS.has(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clause dynamically with parameterised inputs
    const params = [];
    const conditions = [];

    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim()}%`);
      // Reuse the same param index for both columns
      conditions.push(`(al.event_type ILIKE $${params.length} OR al.entity_type ILIKE $${params.length})`);
    }

    if (category && typeof category === 'string' && category.trim()) {
      params.push(category.trim());
      conditions.push(`al.event_type = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // COUNT query (same WHERE, no pagination)
    const countResult = await query(
      `SELECT COUNT(*) FROM audit_log al ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // DATA query
    const dataParams = [...params, limit, offset];
    const dataResult = await query(
      `SELECT al.*, p.name AS actor_name
       FROM audit_log al
       LEFT JOIN people p ON p.id = al.actor_id
       ${whereClause}
       ORDER BY al.${sortField} ${sortOrder}
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      data: dataResult.rows,
      total,
      page: pageNum,
      limit,
    });
  } catch (err) {
    console.error('GET /audit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
