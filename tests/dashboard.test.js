/**
 * dashboard.test.js
 * Landing-dashboard checks:
 *  1. API authorisation and shape (mocked database).
 *  2. Projects-list drill-down filters are whitelisted (mocked database).
 *  3. Metric definitions against real data inside a transaction that is always rolled back
 *     (skipped when DATABASE_URL is absent).
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from '../api/node_modules/express/index.js';
import request from 'supertest';
import pg from 'pg';

vi.mock('../api/src/db/pool.js', () => {
  const mockQuery = vi.fn();
  return { default: { query: mockQuery, connect: vi.fn() }, query: mockQuery, withClient: vi.fn() };
});

vi.mock('../api/src/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.person = JSON.parse(req.headers['x-test-person']);
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

vi.mock('../api/src/middleware/scope.js', () => ({
  resolveProjectScope: (_req, _res, next) => next(),
}));

vi.mock('../api/src/rules/rules.js', () => ({
  auditLog: vi.fn(),
  validateProjectStatusTransition: vi.fn(() => ({ ok: true })),
  canAdvanceToInProgress: vi.fn(() => ({ ok: true })),
  canCompleteProject: vi.fn(() => ({ ok: true })),
}));

import { query } from '../api/src/db/pool.js';
import dashboardRouter from '../api/src/routes/dashboard.js';
import projectsRouter from '../api/src/routes/projects.js';
import { computeDashboard } from '../api/src/services/dashboardMetrics.js';

const app = express();
app.use('/api/dashboard', dashboardRouter);
app.use('/api/projects', projectsRouter);

const ADMIN = { id: 'admin-id', name: 'Admin', email: 'a@test.com', role: 'admin' };
const PARTNER = { id: 'partner-id', name: 'Partner', email: 'p@test.com', role: 'partner_poc' };
const as = (person) => ({ 'x-test-person': JSON.stringify(person) });

function mockDashboardQueries() {
  query.mockImplementation((sql) => {
    if (sql.includes('delivered_on')) {
      return Promise.resolve({ rows: [{ total: '5', not_started: '1', in_progress: '1', completed: '3', completed_on_time: '1', completed_delayed: '1', completed_unclassified: '1' }] });
    }
    if (sql.includes('m.delay_side')) {
      return Promise.resolve({ rows: [{ total: '9', on_time: '4', company_delay: '1', partner_delay: '2' }] });
    }
    return Promise.resolve({ rows: [{ submitted: '1', approved: '2', declined: '1', overridden: '1' }] });
  });
}

describe('GET /api/dashboard: authorisation and shape', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDashboardQueries(); });

  it('scopes admins to everything and partners to their own id, using the session only', async () => {
    await request(app).get('/api/dashboard?project_id=other&person=other').set(as(ADMIN));
    expect(query.mock.calls.every(([, params]) => params[0] === true && params[1] === null)).toBe(true);

    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get('/api/dashboard?project_id=other&person=other').set(as(PARTNER));
    expect(query.mock.calls.every(([, params]) => params[0] === false && params[1] === 'partner-id')).toBe(true);
  });

  it('uses three queries for both roles', async () => {
    await request(app).get('/api/dashboard').set(as(ADMIN));
    expect(query).toHaveBeenCalledTimes(3);
    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get('/api/dashboard').set(as(PARTNER));
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('returns the admin sections as numbers', async () => {
    const res = await request(app).get('/api/dashboard').set(as(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.portfolio).toMatchObject({ total: 5, not_started: 1, in_progress: 1, completed: 3, completed_on_time: 1, completed_delayed: 1 });
    expect(res.body.delivery).toEqual({ total_milestones: 9, on_time: 4, company_delay: 1, partner_delay: 2 });
    expect(res.body.approvals).toEqual({ submitted: 1, approved: 2, declined: 1, overridden: 1 });
  });

  it('returns only the partner sections and no admin-only figures', async () => {
    const res = await request(app).get('/api/dashboard').set(as(PARTNER));
    expect(res.body.role).toBe('partner_poc');
    expect(Object.keys(res.body).sort()).toEqual(['delivery', 'portfolio', 'role']);
    expect(res.body.portfolio).toEqual({ assigned: 5, active: 1, awaiting_my_approval: 1, milestones_on_time: 4, delayed_milestones: 3 });
    expect(res.body.delivery).toEqual({ projects_on_time: 1, projects_delayed: 1, projects_unclassified: 1 });
    const text = JSON.stringify(res.body);
    ['overridden', 'company_delay', 'partner_delay', 'declined', 'total_milestones', 'company_'].forEach((k) => expect(text).not.toContain(k));
  });

  it('reports zero as 0, not missing', async () => {
    query.mockImplementation(() => Promise.resolve({ rows: [{}] }));
    const res = await request(app).get('/api/dashboard').set(as(ADMIN));
    expect(res.body.portfolio.total).toBe(0);
    expect(res.body.approvals.declined).toBe(0);
  });
});

describe('GET /api/projects: dashboard drill-down filters', () => {
  beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue({ rows: [] }); });
  const sqlFor = async (qs, person = ADMIN) => {
    query.mockClear();
    await request(app).get(`/api/projects${qs}`).set(as(person));
    return query.mock.calls[0][0];
  };

  it('maps each approval filter to its approval state', async () => {
    expect(await sqlFor('?approval=pending')).toContain("a.status = 'pending'");
    expect(await sqlFor('?approval=declined')).toContain("a.status = 'rejected'");
    expect(await sqlFor('?approval=overridden')).toContain('a.overridden_by IS NOT NULL');
    expect(await sqlFor('?approval=approved')).toContain('a.overridden_by IS NULL');
  });

  it('maps milestone and outcome filters', async () => {
    expect(await sqlFor('?milestone=company_delay')).toContain("m.delay_side = 'company'");
    expect(await sqlFor('?outcome=delayed')).toContain('> p.approved_end_date');
    expect(await sqlFor('?status=in_progress')).toContain("p.status = 'in_progress'");
  });

  it('ignores unknown values so nothing from the request reaches the SQL', async () => {
    const sql = await sqlFor("?status=x';DROP TABLE people;--&approval=bogus&outcome=%27");
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('bogus');
  });

  it('keeps a partner scoped to their own assignments when filtering', async () => {
    const sql = await sqlFor('?approval=pending', PARTNER);
    expect(sql).toContain("pa.assignment_role = 'poc'");
    expect(query.mock.calls[0][1][0]).toBe('partner-id');
  });
});

// ── Metric definitions against real rows (always rolled back) ──────────────────
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('computeDashboard: metric definitions (rolled-back transaction)', () => {
  let client;
  let realPool;
  beforeAll(async () => {
    realPool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    client = await realPool.connect();
  });
  afterAll(async () => {
    client?.release();
    await realPool?.end();
  });

  it('classifies projects, milestones and approvals as defined', async () => {
    await client.query('BEGIN');
    try {
      const q = async (sql, params) => (await client.query(sql, params)).rows;
      const tag = `T${Date.now()}`;
      const admin = ADMIN_ROW(await q(`INSERT INTO people (name, email, role) VALUES ($1, $2, 'admin') RETURNING id, role, name`, [`Adm ${tag}`, `adm-${tag}@x.test`]));
      const partner = ADMIN_ROW(await q(`INSERT INTO people (name, email, role) VALUES ($1, $2, 'partner_poc') RETURNING id, role, name`, [`Par ${tag}`, `par-${tag}@x.test`]));

      const base = await computeDashboard(client, admin);

      const project = async (code, status, end) =>
        (await q(`INSERT INTO projects (code, title, status, approved_start_date, approved_end_date) VALUES ($1, $2, $3, '2026-01-01', $4) RETURNING id`, [`${tag}-${code}`, `${tag}-${code}`, status, end]))[0].id;
      const milestone = async (pid, done, onTime, side) =>
        (await q(`INSERT INTO milestones (project_id, title, status, completed_at, on_time, delay_side, approved_end_date)
                  VALUES ($1, 'm', $2, $3, $4, $5, '2026-01-10') RETURNING id`, [pid, done ? 'completed' : 'in_progress', done || null, onTime, side]))[0].id;
      const approval = (mid, status, extra = {}) =>
        q(`INSERT INTO approvals (milestone_id, status, overridden_by, rejected_at, rejection_reason) VALUES ($1, $2, $3, $4, $5)`,
          [mid, status, extra.overriddenBy || null, extra.rejectedAt || null, extra.reason || null]);
      const assign = (pid) => q(`INSERT INTO project_assignments (project_id, person_id, assignment_role) VALUES ($1, $2, 'poc')`, [pid, partner.id]);

      // P1: completed on time (delivered 5 Jan), one milestone approved by the partner and one approved after an earlier denial
      const p1 = await project('P1', 'completed', '2026-01-10');
      await approval(await milestone(p1, '2026-01-05T10:00:00Z', true, null), 'approved');
      await approval(await milestone(p1, '2026-01-04T10:00:00Z', true, null), 'approved', { rejectedAt: '2026-01-03', reason: 'redo' });
      // P2: completed with delay (delivered 15 Jan), company side, approved through admin override
      const p2 = await project('P2', 'completed', '2026-01-10');
      await approval(await milestone(p2, '2026-01-15T10:00:00Z', false, 'company'), 'approved', { overriddenBy: admin.id });
      // P3: in progress; partner-side delay currently denied, plus an on-time milestone awaiting the partner
      const p3 = await project('P3', 'in_progress', '2026-03-01');
      await approval(await milestone(p3, '2026-01-20T10:00:00Z', false, 'partner'), 'rejected', { rejectedAt: '2026-01-21', reason: 'no' });
      await approval(await milestone(p3, '2026-01-22T10:00:00Z', true, null), 'pending');
      // P4: not started; P5: completed without an approved end date (cannot be classified)
      await project('P4', 'not_started', '2026-06-01');
      const p5 = await project('P5', 'completed', null);
      await milestone(p5, '2026-01-02T10:00:00Z', true, null);

      await assign(p1); await assign(p2); await assign(p3);

      const after = await computeDashboard(client, admin);
      const d = (a, b) => a - b;
      expect(d(after.portfolio.total, base.portfolio.total)).toBe(5);
      expect(d(after.portfolio.not_started, base.portfolio.not_started)).toBe(1);
      expect(d(after.portfolio.in_progress, base.portfolio.in_progress)).toBe(1);
      expect(d(after.portfolio.completed, base.portfolio.completed)).toBe(3);
      expect(d(after.portfolio.completed_on_time, base.portfolio.completed_on_time)).toBe(1);
      expect(d(after.portfolio.completed_delayed, base.portfolio.completed_delayed)).toBe(1);
      expect(d(after.portfolio.completed_unclassified, base.portfolio.completed_unclassified)).toBe(1);
      expect(d(after.delivery.total_milestones, base.delivery.total_milestones)).toBe(6);
      expect(d(after.delivery.on_time, base.delivery.on_time)).toBe(4);
      expect(d(after.delivery.company_delay, base.delivery.company_delay)).toBe(1);
      expect(d(after.delivery.partner_delay, base.delivery.partner_delay)).toBe(1);
      // denied-then-approved is approved, not declined; an override is not a partner approval
      expect(d(after.approvals.approved, base.approvals.approved)).toBe(2);
      expect(d(after.approvals.overridden, base.approvals.overridden)).toBe(1);
      expect(d(after.approvals.declined, base.approvals.declined)).toBe(1);
      expect(d(after.approvals.submitted, base.approvals.submitted)).toBe(1);

      // The partner only sees their three assigned projects (P4 and P5 are excluded)
      const mine = await computeDashboard(client, partner);
      expect(mine.portfolio).toEqual({ assigned: 3, active: 1, awaiting_my_approval: 1, milestones_on_time: 3, delayed_milestones: 2 });
      expect(mine.delivery).toEqual({ projects_on_time: 1, projects_delayed: 1, projects_unclassified: 0 });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});

function ADMIN_ROW(rows) { return rows[0]; }
