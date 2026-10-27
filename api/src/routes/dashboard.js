import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const LAST_AUTHOR_ROLE = `(
  SELECT pe.role FROM delay_messages dm JOIN people pe ON pe.id = dm.author_id
  WHERE dm.delay_id = d.id ORDER BY dm.created_at DESC LIMIT 1
)`;

const num = (v) => (v === null || v === undefined ? null : Number(v));

// GET /api/dashboard
// Every block answers a different question, so no figure is repeated across tiles.
router.get('/', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.person.role === 'admin';

    let visibleProjectIds;
    if (isAdmin) {
      const all = await query('SELECT id FROM projects WHERE deleted_at IS NULL');
      visibleProjectIds = all.rows.map((r) => r.id);
    } else {
      const assigned = await query(
        `SELECT pa.project_id FROM project_assignments pa
         JOIN projects p ON p.id = pa.project_id
         WHERE pa.person_id = $1 AND pa.assignment_role = 'poc' AND p.deleted_at IS NULL`,
        [req.person.id]
      );
      visibleProjectIds = assigned.rows.map((r) => r.project_id);
    }

    const empty = {
      role: isAdmin ? 'admin' : 'partner_poc',
      kpis: {
        projects: { total: 0, in_progress: 0, not_started: 0, completed: 0 },
        on_time: { on_time: 0, total: 0 },
        avg_approval_days: null,
        open_delay_threads: 0,
        awaiting_my_approval: 0,
        delays_awaiting_me: 0,
      },
      approvalPipeline: null,
      throughputTrend: [],
      delayCauses: [],
      lateByType: [],
      slippage: [],
      upcoming: [],
      projectProgress: [],
    };
    if (!visibleProjectIds.length) return res.json(empty);

    const ids = [visibleProjectIds];

    const [statusRes, onTimeRes, progressRes] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int                                     AS total,
           COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
           COUNT(*) FILTER (WHERE status = 'not_started')::int AS not_started,
           COUNT(*) FILTER (WHERE status = 'completed')::int   AS completed
         FROM projects WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        ids
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE on_time = true)::int AS on_time, COUNT(*)::int AS total
         FROM milestones WHERE project_id = ANY($1::uuid[]) AND status = 'completed'`,
        ids
      ),
      query(
        `SELECT p.id, p.code, p.title, p.status, p.type,
                COUNT(m.id)::int AS total_milestones,
                COUNT(m.id) FILTER (WHERE m.status = 'completed')::int AS completed_milestones
         FROM projects p LEFT JOIN milestones m ON m.project_id = p.id
         WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL
         GROUP BY p.id, p.code, p.title, p.status, p.type
         ORDER BY p.title`,
        ids
      ),
    ]);

    const response = {
      ...empty,
      kpis: {
        ...empty.kpis,
        projects: statusRes.rows[0],
        on_time: onTimeRes.rows[0],
      },
      projectProgress: progressRes.rows,
    };

    if (!isAdmin) {
      const [approvalsRes, delaysRes, upcomingRes] = await Promise.all([
        query(
          `SELECT COUNT(*)::int AS n FROM approvals a
           JOIN milestones m ON m.id = a.milestone_id
           WHERE m.project_id = ANY($1::uuid[]) AND a.status = 'pending'`,
          ids
        ),
        query(
          `SELECT COUNT(*)::int AS n FROM delays d
           JOIN milestones m ON m.id = d.milestone_id
           WHERE m.project_id = ANY($1::uuid[])
             AND (d.status = 'pending' OR (d.status = 'denied' AND ${LAST_AUTHOR_ROLE} = 'admin'))`,
          ids
        ),
        query(
          `SELECT m.id, m.title, p.id AS project_id, p.code, to_char(m.approved_end_date, 'YYYY-MM-DD') AS due_date,
                  (m.approved_end_date - CURRENT_DATE)::int AS days_left
           FROM milestones m JOIN projects p ON p.id = m.project_id
           WHERE m.project_id = ANY($1::uuid[]) AND p.deleted_at IS NULL
             AND m.status <> 'completed' AND m.approved_end_date IS NOT NULL
           ORDER BY m.approved_end_date, m.title
           LIMIT 6`,
          ids
        ),
      ]);
      response.kpis.awaiting_my_approval = approvalsRes.rows[0].n;
      response.kpis.delays_awaiting_me = delaysRes.rows[0].n;
      response.upcoming = upcomingRes.rows;
      return res.json(response);
    }

    const [turnaroundRes, openDelaysRes, pipelineRes, throughputRes, causesRes, lateTypeRes, slippageRes] =
      await Promise.all([
        query(
          `SELECT AVG(EXTRACT(EPOCH FROM (a.approved_at - a.submitted_at)) / 86400.0) AS days
           FROM approvals a JOIN milestones m ON m.id = a.milestone_id
           WHERE m.project_id = ANY($1::uuid[]) AND a.status = 'approved'
             AND a.submitted_at IS NOT NULL AND a.overridden_by IS NULL`,
          ids
        ),
        query(
          `SELECT COUNT(*)::int AS n FROM delays d JOIN milestones m ON m.id = d.milestone_id
           WHERE m.project_id = ANY($1::uuid[]) AND d.status <> 'accepted'`,
          ids
        ),
        query(
          `SELECT
             COUNT(*) FILTER (WHERE a.id IS NULL)::int            AS not_submitted,
             COUNT(*) FILTER (WHERE a.status = 'pending')::int    AS awaiting_partner,
             COUNT(*) FILTER (WHERE a.status = 'rejected')::int   AS denied,
             COUNT(*) FILTER (WHERE a.status = 'approved')::int   AS approved
           FROM milestones m LEFT JOIN approvals a ON a.milestone_id = m.id
           WHERE m.project_id = ANY($1::uuid[]) AND m.status = 'completed'`,
          ids
        ),
        query(
          `SELECT date_trunc('week', completed_at) AS week, COUNT(*)::int AS completions
           FROM milestones
           WHERE project_id = ANY($1::uuid[]) AND status = 'completed'
             AND completed_at > NOW() - INTERVAL '8 weeks'
           GROUP BY week ORDER BY week`,
          ids
        ),
        query(
          `SELECT COALESCE(delay_side, 'unattributed') AS side, COUNT(*)::int AS count
           FROM milestones WHERE project_id = ANY($1::uuid[]) AND on_time = false
           GROUP BY 1`,
          ids
        ),
        query(
          `SELECT COALESCE(p.type, 'Unspecified') AS type,
                  AVG(GREATEST(0, m.completed_at::date - m.approved_end_date))::float AS avg_days_late,
                  COUNT(*)::int AS delayed_milestones
           FROM milestones m JOIN projects p ON p.id = m.project_id
           WHERE p.id = ANY($1::uuid[]) AND m.on_time = false AND m.approved_end_date IS NOT NULL
             AND m.completed_at IS NOT NULL
           GROUP BY 1 ORDER BY avg_days_late DESC`,
          ids
        ),
        query(
          `SELECT * FROM (
             SELECT p.id, p.code, p.title, p.status, to_char(p.approved_end_date, 'YYYY-MM-DD') AS approved_end_date,
                    (ms.total > 0 AND ms.done = ms.total) AS finished,
                    CASE WHEN ms.total > 0 AND ms.done = ms.total
                         THEN (ms.last_done::date - p.approved_end_date)
                         ELSE (CURRENT_DATE - p.approved_end_date) END AS days_over
             FROM projects p
             LEFT JOIN LATERAL (
               SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'completed') AS done,
                      MAX(completed_at) AS last_done
               FROM milestones WHERE project_id = p.id
             ) ms ON true
             WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL AND p.approved_end_date IS NOT NULL
           ) s WHERE days_over > 0 ORDER BY days_over DESC LIMIT 8`,
          ids
        ),
      ]);

    response.kpis.avg_approval_days = num(turnaroundRes.rows[0].days);
    response.kpis.open_delay_threads = openDelaysRes.rows[0].n;
    response.approvalPipeline = pipelineRes.rows[0];
    response.throughputTrend = throughputRes.rows;
    response.delayCauses = causesRes.rows;
    response.lateByType = lateTypeRes.rows;
    response.slippage = slippageRes.rows.map((r) => ({ ...r, days_over: Number(r.days_over) }));
    return res.json(response);
  } catch (err) {
    console.error('GET /dashboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
