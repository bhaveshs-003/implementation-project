import { query } from '../db/pool.js';

// SQL scope layer: ensures a person can only access projects in their scope.
// Out-of-scope requests return 404, not 403.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Errors are passed to next() because Express 4 does not catch rejected promises from async
// middleware; an unhandled rejection (e.g. a malformed id reaching Postgres) would crash the process.
export async function resolveProjectScope(req, res, next) {
  const projectId = req.params.projectId || req.params.id;
  if (!projectId) return next();
  if (!UUID_RE.test(projectId)) return res.status(404).json({ error: 'Not found' });

  try {
    let projectRes;
    if (req.person.role === 'admin') {
      projectRes = await query(
        `SELECT id, code, title, type, status, description,
                company_start_date, company_end_date,
                partner_start_date, partner_end_date,
                approved_start_date, approved_end_date,
                created_by, created_at, updated_at
         FROM projects
         WHERE id = $1 AND deleted_at IS NULL`,
        [projectId]
      );
    } else {
      // Partner POC: only projects where they are assigned as poc
      projectRes = await query(
        `SELECT p.id, p.code, p.title, p.type, p.status, p.description,
                p.company_start_date, p.company_end_date,
                p.partner_start_date, p.partner_end_date,
                p.approved_start_date, p.approved_end_date,
                p.created_by, p.created_at, p.updated_at
         FROM projects p
         JOIN project_assignments pa ON pa.project_id = p.id
         WHERE p.id = $1
           AND p.deleted_at IS NULL
           AND pa.person_id = $2
           AND pa.assignment_role = 'poc'`,
        [projectId, req.person.id]
      );
    }

    if (projectRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    req.project = projectRes.rows[0];
  } catch (err) {
    return next(err);
  }
  next();
}

// Returns the list of project IDs visible to the current user.
export async function visibleProjectIds(personId, role) {
  if (role === 'admin') {
    const res = await query(
      `SELECT id FROM projects WHERE deleted_at IS NULL`,
      []
    );
    return res.rows.map(r => r.id);
  }
  const res = await query(
    `SELECT p.id FROM projects p
     JOIN project_assignments pa ON pa.project_id = p.id
     WHERE pa.person_id = $1 AND pa.assignment_role = 'poc' AND p.deleted_at IS NULL`,
    [personId]
  );
  return res.rows.map(r => r.id);
}
