// Landing-dashboard metrics. Every figure is derived from the current state in the database
// and scoped in SQL: admins see every project, a Partner POC only the projects they are POC on.
// Three queries regardless of data volume or role.

// A project's delivery date is the date its last milestone was completed.
const LAST_DELIVERY_DATE = `(
  SELECT (MAX(m.completed_at) AT TIME ZONE 'UTC')::date FROM milestones m WHERE m.project_id = p.id
)`;

const SCOPE = `p.deleted_at IS NULL AND (
  $1::boolean OR EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = p.id AND pa.person_id = $2::uuid AND pa.assignment_role = 'poc'
  )
)`;

const PROJECTS_SQL = `
  WITH scoped AS (
    SELECT p.status, p.approved_end_date, ${LAST_DELIVERY_DATE} AS delivered_on
    FROM projects p WHERE ${SCOPE}
  )
  SELECT
    COUNT(*)::int                                                         AS total,
    COUNT(*) FILTER (WHERE status = 'not_started')::int                   AS not_started,
    COUNT(*) FILTER (WHERE status = 'in_progress')::int                   AS in_progress,
    COUNT(*) FILTER (WHERE status = 'completed')::int                     AS completed,
    COUNT(*) FILTER (WHERE status = 'completed' AND approved_end_date IS NOT NULL
                       AND delivered_on IS NOT NULL AND delivered_on <= approved_end_date)::int AS completed_on_time,
    COUNT(*) FILTER (WHERE status = 'completed' AND approved_end_date IS NOT NULL
                       AND delivered_on IS NOT NULL AND delivered_on >  approved_end_date)::int AS completed_delayed,
    COUNT(*) FILTER (WHERE status = 'completed'
                       AND (approved_end_date IS NULL OR delivered_on IS NULL))::int            AS completed_unclassified
  FROM scoped`;

const MILESTONES_SQL = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE m.status = 'completed' AND m.on_time = true)::int                              AS on_time,
    COUNT(*) FILTER (WHERE m.status = 'completed' AND m.on_time = false AND m.delay_side = 'company')::int AS company_delay,
    COUNT(*) FILTER (WHERE m.status = 'completed' AND m.on_time = false AND m.delay_side = 'partner')::int AS partner_delay
  FROM milestones m JOIN projects p ON p.id = m.project_id
  WHERE ${SCOPE}`;

const APPROVALS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE a.status = 'pending')::int                                  AS submitted,
    COUNT(*) FILTER (WHERE a.status = 'approved' AND a.overridden_by IS NULL)::int     AS approved,
    COUNT(*) FILTER (WHERE a.status = 'rejected')::int                                 AS declined,
    COUNT(*) FILTER (WHERE a.status = 'approved' AND a.overridden_by IS NOT NULL)::int AS overridden
  FROM approvals a
  JOIN milestones m ON m.id = a.milestone_id
  JOIN projects p ON p.id = m.project_id
  WHERE ${SCOPE}`;

export async function computeDashboard(db, person) {
  const isAdmin = person.role === 'admin';
  const params = [isAdmin, isAdmin ? null : person.id];

  const [projectsRes, milestonesRes, approvalsRes] = await Promise.all([
    db.query(PROJECTS_SQL, params),
    db.query(MILESTONES_SQL, params),
    db.query(APPROVALS_SQL, params),
  ]);
  const p = projectsRes.rows[0] || {};
  const m = milestonesRes.rows[0] || {};
  const a = approvalsRes.rows[0] || {};
  const n = (v) => Number(v) || 0;

  if (isAdmin) {
    return {
      role: 'admin',
      portfolio: {
        total: n(p.total), not_started: n(p.not_started), in_progress: n(p.in_progress),
        completed: n(p.completed), completed_on_time: n(p.completed_on_time), completed_delayed: n(p.completed_delayed),
        completed_unclassified: n(p.completed_unclassified),
      },
      delivery: {
        total_milestones: n(m.total), on_time: n(m.on_time),
        company_delay: n(m.company_delay), partner_delay: n(m.partner_delay),
      },
      approvals: {
        submitted: n(a.submitted), approved: n(a.approved), declined: n(a.declined), overridden: n(a.overridden),
      },
    };
  }

  return {
    role: 'partner_poc',
    portfolio: {
      assigned: n(p.total), active: n(p.in_progress),
      awaiting_my_approval: n(a.submitted),
      milestones_on_time: n(m.on_time),
      delayed_milestones: n(m.company_delay) + n(m.partner_delay),
    },
    delivery: {
      projects_on_time: n(p.completed_on_time), projects_delayed: n(p.completed_delayed),
      projects_unclassified: n(p.completed_unclassified),
    },
  };
}
