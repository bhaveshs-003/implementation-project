import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /
// Base: /api/dashboard
router.get('/', requireAuth, async (req, res) => {
  try {
    // Determine which project IDs this caller may see
    let visibleProjectIds;
    if (req.person.role === 'admin') {
      const allResult = await query(
        'SELECT id FROM projects WHERE deleted_at IS NULL'
      );
      visibleProjectIds = allResult.rows.map((r) => r.id);
    } else {
      const assignedResult = await query(
        'SELECT project_id FROM project_assignments WHERE person_id = $1',
        [req.person.id]
      );
      visibleProjectIds = assignedResult.rows.map((r) => r.project_id);
    }

    // Short-circuit when there are no visible projects
    if (!visibleProjectIds.length) {
      return res.json({
        counters: { total: 0, in_progress: 0, not_started: 0, completed: 0 },
        ...(req.person.role === 'admin'
          ? {
              onTimeVsDelayed: [],
              delayAttribution: [],
              qualityByType: [],
              throughputTrend: [],
              delayedProjects: [],
              projectProgress: [],
            }
          : {}),
      });
    }

    // COUNTERS — all roles
    const countersResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL)                                    AS total,
         COUNT(*) FILTER (WHERE status = 'in_progress'  AND deleted_at IS NULL)        AS in_progress,
         COUNT(*) FILTER (WHERE status = 'not_started'  AND deleted_at IS NULL)        AS not_started,
         COUNT(*) FILTER (WHERE status = 'completed'    AND deleted_at IS NULL)        AS completed
       FROM projects
       WHERE id = ANY($1::uuid[])`,
      [visibleProjectIds]
    );

    const counters = {
      total: parseInt(countersResult.rows[0].total, 10),
      in_progress: parseInt(countersResult.rows[0].in_progress, 10),
      not_started: parseInt(countersResult.rows[0].not_started, 10),
      completed: parseInt(countersResult.rows[0].completed, 10),
    };

    // Partners get only the counters
    if (req.person.role !== 'admin') {
      return res.json({ counters });
    }

    // ADMIN — run all additional analytics in parallel
    const [
      onTimeResult,
      delayAttrResult,
      qualityResult,
      throughputResult,
      delayedProjectsResult,
      projectProgressResult,
    ] = await Promise.all([
      // 1. On-Time vs Delayed (completed milestones)
      query(
        `SELECT on_time, COUNT(*) AS count
         FROM milestones
         WHERE project_id = ANY($1::uuid[]) AND status = 'completed'
         GROUP BY on_time`,
        [visibleProjectIds]
      ),

      // 2. Delay Attribution (by delay_side on delayed milestones)
      query(
        `SELECT delay_side, COUNT(*) AS count
         FROM milestones
         WHERE project_id = ANY($1::uuid[]) AND on_time = false
         GROUP BY delay_side`,
        [visibleProjectIds]
      ),

      // 3. Quality by Project Type (delayed milestones grouped by project type + delay_side)
      query(
        `SELECT p.type, m.delay_side, COUNT(*) AS count
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         WHERE p.id = ANY($1::uuid[]) AND m.on_time = false
         GROUP BY p.type, m.delay_side`,
        [visibleProjectIds]
      ),

      // 4. Throughput trend — weekly completions over the past 8 weeks
      query(
        `SELECT date_trunc('week', completed_at) AS week, COUNT(*) AS completions
         FROM milestones
         WHERE project_id = ANY($1::uuid[])
           AND status = 'completed'
           AND completed_at > NOW() - INTERVAL '8 weeks'
         GROUP BY week
         ORDER BY week`,
        [visibleProjectIds]
      ),

      // 5. Delayed Projects — delay counts per project
      query(
        `SELECT
           p.id,
           p.code,
           p.title,
           COUNT(*) FILTER (WHERE m.delay_side = 'company')               AS company_delays,
           COUNT(*) FILTER (WHERE m.delay_side = 'partner')               AS partner_delays,
           COUNT(*) FILTER (WHERE m.delay_side IS NULL AND m.on_time = false) AS unattributed_delays
         FROM projects p
         JOIN milestones m ON m.project_id = p.id
         WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL AND m.on_time = false
         GROUP BY p.id, p.code, p.title
         HAVING COUNT(*) > 0`,
        [visibleProjectIds]
      ),

      // 6. Project Progress — milestone completion per project
      query(
        `SELECT
           p.id,
           p.code,
           p.title,
           p.status,
           p.type,
           COUNT(m.id)                                          AS total_milestones,
           COUNT(m.id) FILTER (WHERE m.status = 'completed')   AS completed_milestones
         FROM projects p
         LEFT JOIN milestones m ON m.project_id = p.id
         WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL
         GROUP BY p.id, p.code, p.title, p.status, p.type
         ORDER BY p.title`,
        [visibleProjectIds]
      ),
    ]);

    return res.json({
      counters,
      onTimeVsDelayed: onTimeResult.rows,
      delayAttribution: delayAttrResult.rows,
      qualityByType: qualityResult.rows,
      throughputTrend: throughputResult.rows,
      delayedProjects: delayedProjectsResult.rows,
      projectProgress: projectProgressResult.rows,
    });
  } catch (err) {
    console.error('GET /dashboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
