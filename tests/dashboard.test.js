/**
 * dashboard.test.js
 * Landing-dashboard checks:
 *  1. API authorisation, scoping and shape (mocked database).
 *  2. Projects-list drill-down filters are whitelisted (mocked database).
 *  3. Metric definitions against real rows inside a transaction that is always rolled back
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
import { computeDashboard, rangeStart } from '../api/src/services/dashboardMetrics.js';

const app = express();
app.use('/api/dashboard', dashboardRouter);
app.use('/api/projects', projectsRouter);

const ADMIN = { id: 'admin-id', name: 'Admin', email: 'a@test.com', role: 'admin' };
const PARTNER = { id: 'partner-id', name: 'Partner', email: 'p@test.com', role: 'partner_poc' };
const OTHER_PARTNER = '11111111-2222-4333-8444-555555555555';
const as = (person) => ({ 'x-test-person': JSON.stringify(person) });

function mockDashboardQueries() {
  query.mockImplementation((sql) => {
    if (sql.includes('delivered_on')) {
      return Promise.resolve({ rows: [{ total: '5', not_started: '1', in_progress: '1', completed: '3', completed_on_time: '1', completed_delayed: '1', completed_unclassified: '1' }] });
    }
    if (sql.includes('not_completed')) {
      return Promise.resolve({ rows: [{ total: '9', on_time: '4', company_delay: '1', partner_delay: '2', not_completed: '2' }] });
    }
    if (sql.includes('partner_approved')) {
      return Promise.resolve({ rows: [{ partner_approved: '2', overridden: '1', awaiting: '1', declined: '1' }] });
    }
    if (sql.includes('WITH rows AS')) {
      return Promise.resolve({ rows: [{ milestone_id: 'm1', milestone_title: 'M', project_id: 'p1', project_code: 'P', project_title: 'Proj', state: 'awaiting', since: null, partner_names: 'Pat', override_by: null, override_reason: null, total: 1 }] });
    }
    return Promise.resolve({ rows: [{ id: 'x', name: 'Partner One' }] });
  });
}

describe('GET /api/dashboard: authorisation, scoping and shape', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDashboardQueries(); });

  it('scopes admins to everything and partners to their own id', async () => {
    await request(app).get('/api/dashboard?person=other').set(as(ADMIN));
    const adminScoped = query.mock.calls.filter(([sql]) => sql.includes('$1::boolean'));
    expect(adminScoped.length).toBeGreaterThan(0);
    expect(adminScoped.every(([, params]) => params[0] === true && params[1] === null)).toBe(true);

    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get('/api/dashboard?person=other').set(as(PARTNER));
    const partnerScoped = query.mock.calls.filter(([sql]) => sql.includes('$1::boolean'));
    expect(partnerScoped.every(([, params]) => params[0] === false && params[1] === 'partner-id')).toBe(true);
  });

  it('lets an admin narrow to one partner but ignores that filter for a Partner POC', async () => {
    await request(app).get(`/api/dashboard?partner=${OTHER_PARTNER}`).set(as(ADMIN));
    expect(query.mock.calls[0][1][3]).toBe(OTHER_PARTNER);

    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get(`/api/dashboard?partner=${OTHER_PARTNER}`).set(as(PARTNER));
    expect(query.mock.calls.every(([sql, params]) => !sql.includes('$4') || params[3] === null)).toBe(true);

    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get("/api/dashboard?partner=not-a-uuid'--").set(as(ADMIN));
    expect(query.mock.calls[0][1][3]).toBeNull();
  });

  it('turns the range into a start date and ignores unknown ranges', async () => {
    await request(app).get('/api/dashboard?range=month').set(as(ADMIN));
    expect(query.mock.calls[0][1][2]).toBe(rangeStart('month'));
    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get('/api/dashboard?range=forever').set(as(ADMIN));
    expect(query.mock.calls[0][1][2]).toBeNull();
    expect(rangeStart('quarter', new Date('2026-11-02T10:00:00Z'))).toBe('2026-10-01T00:00:00.000Z');
    expect(rangeStart('month', new Date('2026-11-02T10:00:00Z'))).toBe('2026-11-01T00:00:00.000Z');
    expect(rangeStart('all')).toBeNull();
  });

  it('uses a bounded number of queries: 5 for admins, 4 for partners', async () => {
    await request(app).get('/api/dashboard').set(as(ADMIN));
    expect(query).toHaveBeenCalledTimes(5);
    vi.clearAllMocks(); mockDashboardQueries();
    await request(app).get('/api/dashboard').set(as(PARTNER));
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('returns the admin figures as numbers, with the partner list', async () => {
    const res = await request(app).get('/api/dashboard').set(as(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ projects: 5, milestones: 9 });
    expect(res.body.delivery).toEqual({ on_time: 4, company_delay: 1, partner_delay: 2, not_completed: 2 });
    expect(res.body.approvals).toEqual({ partner_approved: 2, overridden: 1, awaiting: 1, declined: 1 });
    expect(res.body.partners).toEqual([{ id: 'x', name: 'Partner One' }]);
    expect(res.body.attention.rows[0].owner).toBe('Pat');
  });

  it('returns a partner no company/partner split, no override figures and no owners', async () => {
    const res = await request(app).get('/api/dashboard').set(as(PARTNER));
    expect(res.body.role).toBe('partner_poc');
    expect(Object.keys(res.body).sort()).toEqual(['approvals', 'attention', 'delivery', 'generated_at', 'pipeline', 'range', 'role', 'totals']);
    expect(res.body.delivery).toEqual({ on_time: 4, delayed: 3, not_completed: 2 });
    expect(res.body.approvals).toEqual({ approved: 3, awaiting: 1, declined: 1 });
    const text = JSON.stringify(res.body);
    ['overridden', 'override', 'company_delay', 'partner_delay', 'partners', 'owner', 'Pat'].forEach((k) => expect(text).not.toContain(k));
  });

  it('reports zero as 0, not missing', async () => {
    query.mockImplementation(() => Promise.resolve({ rows: [{}] }));
    const res = await request(app).get('/api/dashboard').set(as(ADMIN));
    expect(res.body.totals.projects).toBe(0);
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
      const admin = (await q(`INSERT INTO people (name, email, role) VALUES ($1, $2, 'admin') RETURNING id, role, name`, [`Adm ${tag}`, `adm-${tag}@x.test`]))[0];
      const partner = (await q(`INSERT INTO people (name, email, role) VALUES ($1, $2, 'partner_poc') RETURNING id, role, name`, [`Par ${tag}`, `par-${tag}@x.test`]))[0];

      const base = await computeDashboard(client, admin);
      const baseMonth = await computeDashboard(client, admin, { range: 'month' });

      const project = async (code, status, end) =>
        (await q(`INSERT INTO projects (code, title, status, approved_start_date, approved_end_date) VALUES ($1, $2, $3, '2026-01-01', $4) RETURNING id`, [`${tag}-${code}`, `${tag}-${code}`, status, end]))[0].id;
      const milestone = async (pid, title, doneAt, onTime, side) =>
        (await q(`INSERT INTO milestones (project_id, title, status, completed_at, on_time, delay_side, approved_end_date)
                  VALUES ($1, $2, 'completed', $3, $4, $5, '2026-01-10') RETURNING id`, [pid, title, doneAt, onTime, side]))[0].id;
      const approval = (mid, status, extra = {}) =>
        q(`INSERT INTO approvals (milestone_id, status, overridden_by, approved_at, rejected_at, rejection_reason, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [mid, status, extra.overriddenBy || null, extra.approvedAt || null, extra.rejectedAt || null, extra.reason || null]);
      const assign = (pid) => q(`INSERT INTO project_assignments (project_id, person_id, assignment_role) VALUES ($1, $2, 'poc')`, [pid, partner.id]);

      // P1: completed on time (delivered 5 Jan); one milestone approved by the partner, one approved after an earlier denial
      const p1 = await project('P1', 'completed', '2026-01-10');
      await approval(await milestone(p1, `${tag}-a`, '2026-01-05T10:00:00Z', true, null), 'approved');
      await approval(await milestone(p1, `${tag}-b`, '2026-01-04T10:00:00Z', true, null), 'approved', { rejectedAt: '2026-01-03', reason: 'redo' });
      // P2: completed with delay (delivered 15 Jan), company side, approved through admin override
      const p2 = await project('P2', 'completed', '2026-01-10');
      await approval(await milestone(p2, `${tag}-ovr`, '2026-01-15T10:00:00Z', false, 'company'), 'approved', { overriddenBy: admin.id, approvedAt: new Date().toISOString() });
      // P3: in progress; partner-side delay currently denied, plus an on-time milestone awaiting the partner
      const p3 = await project('P3', 'in_progress', '2026-03-01');
      await approval(await milestone(p3, `${tag}-decl`, '2026-01-20T10:00:00Z', false, 'partner'), 'rejected', { rejectedAt: '2026-01-21', reason: 'no' });
      await approval(await milestone(p3, `${tag}-wait`, '2026-01-22T10:00:00Z', true, null), 'pending');
      // P4: not started; P5: completed without an approved end date (cannot be classified)
      await project('P4', 'not_started', '2026-06-01');
      const p5 = await project('P5', 'completed', null);
      await milestone(p5, `${tag}-p5`, '2026-01-02T10:00:00Z', true, null);
      await assign(p1); await assign(p2); await assign(p3);

      const after = await computeDashboard(client, admin);
      const d = (a, b) => a - b;
      expect(d(after.totals.projects, base.totals.projects)).toBe(5);
      expect(d(after.totals.milestones, base.totals.milestones)).toBe(6);
      expect(d(after.pipeline.not_started, base.pipeline.not_started)).toBe(1);
      expect(d(after.pipeline.in_progress, base.pipeline.in_progress)).toBe(1);
      expect(d(after.pipeline.completed, base.pipeline.completed)).toBe(3);
      expect(d(after.pipeline.completed_on_time, base.pipeline.completed_on_time)).toBe(1);
      expect(d(after.pipeline.completed_delayed, base.pipeline.completed_delayed)).toBe(1);
      expect(d(after.pipeline.completed_unclassified, base.pipeline.completed_unclassified)).toBe(1);
      expect(d(after.delivery.on_time, base.delivery.on_time)).toBe(4);
      expect(d(after.delivery.company_delay, base.delivery.company_delay)).toBe(1);
      expect(d(after.delivery.partner_delay, base.delivery.partner_delay)).toBe(1);
      // denied-then-approved is approved, not declined; an override is not a partner approval
      expect(d(after.approvals.partner_approved, base.approvals.partner_approved)).toBe(2);
      expect(d(after.approvals.overridden, base.approvals.overridden)).toBe(1);
      expect(d(after.approvals.declined, base.approvals.declined)).toBe(1);
      expect(d(after.approvals.awaiting, base.approvals.awaiting)).toBe(1);

      // Needs attention lists the declined and awaiting milestones and the recent override
      const mine = after.attention.rows.filter((r) => r.milestone_title.startsWith(tag));
      expect(mine.map((r) => [r.milestone_title.slice(tag.length + 1), r.state]).sort()).toEqual([['decl', 'declined'], ['ovr', 'override'], ['wait', 'awaiting']]);

      // This month: January completions fall outside the range, but approvals just recorded are inside it
      const month = await computeDashboard(client, admin, { range: 'month' });
      expect(d(month.delivery.on_time, baseMonth.delivery.on_time)).toBe(0);
      expect(d(month.delivery.partner_delay, baseMonth.delivery.partner_delay)).toBe(0);
      expect(d(month.approvals.partner_approved, baseMonth.approvals.partner_approved)).toBe(2);
      expect(d(month.pipeline.completed, baseMonth.pipeline.completed)).toBe(3);

      // The partner only sees their three assigned projects (P4 and P5 are excluded) and no admin-only keys
      const own = await computeDashboard(client, partner, { partnerId: admin.id });
      expect(own.totals.projects).toBe(3);
      expect(own.delivery).toEqual({ on_time: 3, delayed: 2, not_completed: 0 });
      expect(own.approvals).toEqual({ approved: 3, awaiting: 1, declined: 1 });
      expect(own.attention.rows.map((r) => r.state)).toEqual(['awaiting']);
      expect(JSON.stringify(own)).not.toContain('override');

      // An admin can narrow to that partner and gets the same three projects
      const narrowed = await computeDashboard(client, admin, { partnerId: partner.id });
      expect(narrowed.totals.projects).toBe(3);
      expect(narrowed.delivery.on_time).toBe(3);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
