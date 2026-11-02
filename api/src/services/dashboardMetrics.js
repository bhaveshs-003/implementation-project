// Landing-dashboard metrics. Every figure is derived from the current state in the database
// and scoped in SQL: admins see every project (optionally narrowed to one Partner POC), a
// Partner POC only the projects they are POC on. The time range limits completed-milestone and
// approval figures to activity inside the period; the pipeline and open work are always current.

export const RANGES = ['all', 'quarter', 'month'];

export function rangeStart(range, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (range === 'month') return new Date(Date.UTC(y, m, 1)).toISOString();
  if (range === 'quarter') return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1)).toISOString();
  return null;
}

// A project's delivery date is the date its last milestone was completed.
const LAST_DELIVERY_DATE = `(
  SELECT (MAX(m.completed_at) AT TIME ZONE 'UTC')::date FROM milestones m WHERE m.project_id = p.id
)`;

// $1 isAdmin, $2 person id, $3 range start, $4 partner filter (admin only)
const SCOPE = `p.deleted_at IS NULL
  AND ($1::boolean OR EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = p.id AND pa.person_id = $2::uuid AND pa.assignment_role = 'poc'))
  AND ($4::uuid IS NULL OR EXISTS (
    SELECT 1 FROM project_assignments pf
    WHERE pf.project_id = p.id AND pf.person_id = $4::uuid AND pf.assignment_role = 'poc'))
  AND ($3::timestamptz IS NULL OR TRUE)`; // keeps $3 typed in queries that do not use the range

const IN_RANGE = (col) => `($3::timestamptz IS NULL OR ${col} >= $3::timestamptz)`;

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
    COUNT(*) FILTER (WHERE m.status = 'completed' AND m.on_time = true
                       AND ${IN_RANGE('m.completed_at')})::int                                AS on_time,
    COUNT(*) FILTER (WHERE m.status = 'completed' AND m.on_time = false AND m.delay_side = 'company'
                       AND ${IN_RANGE('m.completed_at')})::int                                AS company_delay,
    COUNT(*) FILTER (WHERE m.status = 'completed' AND m.on_time = false AND m.delay_side = 'partner'
                       AND ${IN_RANGE('m.completed_at')})::int                                AS partner_delay,
    COUNT(*) FILTER (WHERE m.status <> 'completed')::int                                      AS not_completed
  FROM milestones m JOIN projects p ON p.id = m.project_id
  WHERE ${SCOPE}`;

const APPROVALS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE a.status = 'approved' AND a.overridden_by IS NULL
                       AND ${IN_RANGE('a.updated_at')})::int AS partner_approved,
    COUNT(*) FILTER (WHERE a.status = 'approved' AND a.overridden_by IS NOT NULL
                       AND ${IN_RANGE('a.updated_at')})::int AS overridden,
    COUNT(*) FILTER (WHERE a.status = 'pending'  AND ${IN_RANGE('a.updated_at')})::int AS awaiting,
    COUNT(*) FILTER (WHERE a.status = 'rejected' AND ${IN_RANGE('a.updated_at')})::int AS declined
  FROM approvals a
  JOIN milestones m ON m.id = a.milestone_id
  JOIN projects p ON p.id = m.project_id
  WHERE ${SCOPE}`;

// Open sign-off work (always current), plus admin overrides from the last 30 days for visibility.
// A Partner POC only sees what is waiting on them.
const ATTENTION_SQL = `
  WITH rows AS (
    SELECT m.id AS milestone_id, m.title AS milestone_title,
           p.id AS project_id, p.code AS project_code, p.title AS project_title,
           CASE WHEN a.status = 'rejected' THEN 'declined' WHEN a.status = 'pending' THEN 'awaiting' ELSE 'override' END AS state,
           CASE WHEN a.status = 'rejected' THEN a.rejected_at WHEN a.status = 'pending' THEN a.submitted_at ELSE a.approved_at END AS since,
           a.override_reason,
           (SELECT string_agg(pe.name, ', ' ORDER BY pe.name)
              FROM project_assignments pz JOIN people pe ON pe.id = pz.person_id
              WHERE pz.project_id = p.id AND pz.assignment_role = 'poc') AS partner_names,
           (SELECT pe.name FROM people pe WHERE pe.id = a.overridden_by) AS override_by
    FROM approvals a
    JOIN milestones m ON m.id = a.milestone_id
    JOIN projects p ON p.id = m.project_id
    WHERE ${SCOPE}
      AND ( a.status = 'pending'
            OR ($1::boolean AND (a.status = 'rejected'
                 OR (a.status = 'approved' AND a.overridden_by IS NOT NULL AND a.approved_at >= NOW() - INTERVAL '30 days'))) )
  )
  SELECT *, COUNT(*) OVER()::int AS total FROM rows
  ORDER BY CASE state WHEN 'declined' THEN 0 WHEN 'awaiting' THEN 1 ELSE 2 END,
           CASE WHEN state = 'override' THEN -EXTRACT(EPOCH FROM since) ELSE EXTRACT(EPOCH FROM since) END ASC NULLS LAST
  LIMIT 10`;

const PARTNERS_SQL = `SELECT id, name FROM people WHERE role = 'partner_poc' ORDER BY name`;

export async function computeDashboard(db, person, opts = {}) {
  const isAdmin = person.role === 'admin';
  const range = RANGES.includes(opts.range) ? opts.range : 'all';
  const partnerId = isAdmin ? (opts.partnerId || null) : null;
  const params = [isAdmin, isAdmin ? null : person.id, rangeStart(range), partnerId];

  const [projectsRes, milestonesRes, approvalsRes, attentionRes, partnersRes] = await Promise.all([
    db.query(PROJECTS_SQL, params),
    db.query(MILESTONES_SQL, params),
    db.query(APPROVALS_SQL, params),
    db.query(ATTENTION_SQL, params),
    isAdmin ? db.query(PARTNERS_SQL, []) : Promise.resolve({ rows: [] }),
  ]);
  const p = projectsRes.rows[0] || {};
  const m = milestonesRes.rows[0] || {};
  const a = approvalsRes.rows[0] || {};
  const n = (v) => Number(v) || 0;

  const pipeline = {
    not_started: n(p.not_started), in_progress: n(p.in_progress), completed: n(p.completed),
    completed_on_time: n(p.completed_on_time), completed_delayed: n(p.completed_delayed),
    completed_unclassified: n(p.completed_unclassified),
  };
  const base = {
    role: isAdmin ? 'admin' : 'partner_poc',
    range,
    generated_at: new Date().toISOString(),
    totals: { projects: n(p.total), milestones: n(m.total) },
    pipeline,
  };
  const attentionRows = attentionRes.rows;
  const attentionTotal = n(attentionRows[0]?.total);

  if (isAdmin) {
    return {
      ...base,
      partnerId,
      partners: partnersRes.rows,
      delivery: {
        on_time: n(m.on_time), company_delay: n(m.company_delay), partner_delay: n(m.partner_delay),
        not_completed: n(m.not_completed),
      },
      approvals: {
        partner_approved: n(a.partner_approved), overridden: n(a.overridden),
        awaiting: n(a.awaiting), declined: n(a.declined),
      },
      attention: {
        total: attentionTotal,
        rows: attentionRows.map((r) => ({
          milestone_id: r.milestone_id, milestone_title: r.milestone_title,
          project_id: r.project_id, project_code: r.project_code, project_title: r.project_title,
          state: r.state, since: r.since, owner: r.state === 'override' ? r.override_by : r.partner_names,
          note: r.state === 'override' ? r.override_reason : null,
        })),
      },
    };
  }

  // Partner POC: sides are combined and nothing admin-only is included.
  return {
    ...base,
    delivery: {
      on_time: n(m.on_time), delayed: n(m.company_delay) + n(m.partner_delay), not_completed: n(m.not_completed),
    },
    approvals: {
      approved: n(a.partner_approved) + n(a.overridden), awaiting: n(a.awaiting), declined: n(a.declined),
    },
    attention: {
      total: attentionTotal,
      rows: attentionRows.map((r) => ({
        milestone_id: r.milestone_id, milestone_title: r.milestone_title,
        project_id: r.project_id, project_code: r.project_code, project_title: r.project_title,
        state: r.state, since: r.since,
      })),
    },
  };
}
