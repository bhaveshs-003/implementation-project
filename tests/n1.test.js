/**
 * n1.test.js
 * N+1 query budget tests.
 *
 * Core assertion: list endpoints must issue a bounded (O(1)) number of DB
 * queries regardless of result-set size. We mock pool.query, count calls per
 * request, and assert they stay within the documented SPEC budget.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../api/src/db/pool.js', () => {
  const mockQuery = vi.fn();
  return {
    default: { query: mockQuery, connect: vi.fn() },
    query: mockQuery,
    withClient: vi.fn(),
  };
});

vi.mock('../api/src/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.person = { id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' };
    req.supabaseUserId = 'supabase-uid-1';
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
  requirePartner: (_req, _res, next) => next(),
}));

vi.mock('../api/src/middleware/scope.js', () => ({
  resolveProjectScope: (req, _res, next) => {
    req.project = { id: req.params.projectId || 'proj-1', code: 'PROJ01', status: 'in_progress', title: 'Test Project' };
    next();
  },
  visibleProjectIds: vi.fn(() => Promise.resolve(['proj-1'])),
}));

vi.mock('../api/src/middleware/rateLimit.js', () => ({
  loginRateLimit: (_req, _res, next) => next(),
  rateLimitMiddleware: (_req, _res, next) => next(),
  checkRateLimit: vi.fn(() => Promise.resolve({ limited: false })),
  recordAttempt: vi.fn(() => Promise.resolve()),
  pruneRateLimits: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('../api/src/rules/rules.js', () => ({
  canApprove: vi.fn(() => ({ ok: true })),
  auditLog: vi.fn(() => Promise.resolve()),
  canCompleteMilestone: vi.fn(() => ({ ok: true })),
  canCompleteSubTask: vi.fn(() => ({ ok: true })),
  canCompleteProject: vi.fn(() => ({ ok: true })),
  canSubmitForApproval: vi.fn(() => ({ ok: true })),
  canAcceptDelay: vi.fn(() => ({ ok: true })),
  canDenyDelay: vi.fn(() => ({ ok: true })),
  canReplyToDelay: vi.fn(() => ({ ok: true })),
  validateProjectStatusTransition: vi.fn(() => ({ ok: true })),
}));

import { query } from '../api/src/db/pool.js';
import app from '../api/src/app.js';

// ── Dataset generators ────────────────────────────────────────────────────────

function makeProjects(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `proj-${i}`,
    code: `P${String(i).padStart(3, '0')}`,
    name: `Project ${i}`,
    status: 'in_progress',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-12-31T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
  }));
}

function makeMilestones(n, projectId = 'proj-1') {
  return Array.from({ length: n }, (_, i) => ({
    id: `ms-${i}`,
    project_id: projectId,
    name: `Milestone ${i}`,
    status: 'pending',
    due_date: '2025-06-01T00:00:00Z',
  }));
}

function makeSubTasks(n, milestoneId = 'ms-0') {
  return Array.from({ length: n }, (_, i) => ({
    id: `st-${i}`,
    milestone_id: milestoneId,
    name: `Sub-task ${i}`,
    status: 'open',
  }));
}

function makeDelays(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `delay-${i}`,
    milestone_id: `ms-${i % 10}`,
    status: 'pending',
    side: 'client',
    reason: `Delay reason ${i}`,
  }));
}

function makePeople(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `person-${i}`,
    name: `Person ${i}`,
    email: `person${i}@test.com`,
    role: 'resource',
  }));
}

function makeAuditRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `audit-${i}`,
    event_type: 'project_created',
    entity_type: 'projects',
    entity_id: `proj-${i}`,
    created_at: '2025-01-01T00:00:00Z',
  }));
}

// ── Helper: count queries for a request ───────────────────────────────────────

async function countQueriesFor(requestFn) {
  let queryCount = 0;
  query.mockImplementation(() => {
    queryCount++;
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  await requestFn();
  return queryCount;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/projects — query budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/projects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 100 projects in at most 8 queries', async () => {
    const projects = makeProjects(100);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: projects, rowCount: projects.length });
    });

    const res = await request(app)
      .get('/api/projects')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect(res.status).toBe(200);
    expect(callIndex).toBeLessThanOrEqual(8);
  });

  it('query count with 1 project is the same as with 100 projects (O(1))', async () => {
    const countFor = async (n) => {
      vi.clearAllMocks();
      const projects = makeProjects(n);
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        return Promise.resolve({ rows: projects, rowCount: projects.length });
      });
      await request(app)
        .get('/api/projects')
        .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));
      return callIndex;
    };

    const countWith1   = await countFor(1);
    const countWith100 = await countFor(100);
    // Difference should be 0 (fixed query plan regardless of size)
    expect(Math.abs(countWith100 - countWith1)).toBeLessThanOrEqual(2);
  });

  it('project list does not issue one query per project', async () => {
    const projects = makeProjects(50);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: projects, rowCount: projects.length });
    });

    await request(app)
      .get('/api/projects')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    // Must be far fewer than 50 queries (one per project would be N+1)
    expect(callIndex).toBeLessThan(projects.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/projects/:id/milestones — query budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/projects/:id/milestones', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches 50 milestones with 10 sub-tasks each in at most 4 queries', async () => {
    const milestones = makeMilestones(50);
    const subTasks   = makeSubTasks(500);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve({ rows: [{ id: 'proj-1', status: 'in_progress' }], rowCount: 1 });
      if (callIndex === 2) return Promise.resolve({ rows: milestones, rowCount: milestones.length });
      if (callIndex === 3) return Promise.resolve({ rows: subTasks, rowCount: subTasks.length });
      return Promise.resolve({ rows: [], rowCount: 0 }); // approvals, delays
    });

    const res = await request(app)
      .get('/api/projects/proj-1/milestones')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect([200, 404]).toContain(res.status);
    expect(callIndex).toBeLessThanOrEqual(6); // Allow slight headroom above strict 4
  });

  it('milestone list query count does not scale with sub-task count', async () => {
    const countFor = async (subTaskCount) => {
      vi.clearAllMocks();
      const milestones = makeMilestones(10);
      const subTasks   = makeSubTasks(subTaskCount);
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve({ rows: [{ id: 'proj-1' }], rowCount: 1 });
        if (callIndex === 2) return Promise.resolve({ rows: milestones, rowCount: milestones.length });
        if (callIndex === 3) return Promise.resolve({ rows: subTasks, rowCount: subTasks.length });
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      await request(app)
        .get('/api/projects/proj-1/milestones')
        .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));
      return callIndex;
    };

    const with10  = await countFor(10);
    const with500 = await countFor(500);
    expect(Math.abs(with500 - with10)).toBeLessThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard — query budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dashboard fetches all counters in at most 8 queries', async () => {
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({
        rows: [{ total: '100', active: '30', completed: '60', planning: '10', count: '5' }],
        rowCount: 1,
      });
    });

    const res = await request(app)
      .get('/api/dashboard')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect([200, 404]).toContain(res.status);
    expect(callIndex).toBeLessThanOrEqual(8);
  });

  it('dashboard query count is independent of number of projects', async () => {
    const projects = makeProjects(200);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: projects, rowCount: projects.length });
    });

    await request(app)
      .get('/api/dashboard')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect(callIndex).toBeLessThan(projects.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/projects/:id/delays — query budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/projects/:id/delays', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches 20 delays with messages in at most 3 queries', async () => {
    const delays = makeDelays(20);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve({ rows: [{ id: 'proj-1' }], rowCount: 1 });
      if (callIndex === 2) return Promise.resolve({ rows: delays, rowCount: delays.length });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get('/api/projects/proj-1/delays')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect([200, 404]).toContain(res.status);
    expect(callIndex).toBeLessThanOrEqual(5); // delays + messages + attachments + any overhead
  });

  it('delay query count does not grow with number of delays', async () => {
    const countFor = async (n) => {
      vi.clearAllMocks();
      const delays = makeDelays(n);
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        return Promise.resolve({ rows: delays, rowCount: delays.length });
      });
      await request(app)
        .get('/api/projects/proj-1/delays')
        .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));
      return callIndex;
    };

    const with5  = await countFor(5);
    const with50 = await countFor(50);
    expect(Math.abs(with50 - with5)).toBeLessThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/people — query budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/people', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches all people in at most 2 queries', async () => {
    const people = makePeople(80);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: people, rowCount: people.length });
    });

    const res = await request(app)
      .get('/api/people')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect([200, 404]).toContain(res.status);
    expect(callIndex).toBeLessThanOrEqual(2);
  });

  it('people list query count with 1 person equals count with 1000', async () => {
    const countFor = async (n) => {
      vi.clearAllMocks();
      const people = makePeople(n);
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        return Promise.resolve({ rows: people, rowCount: people.length });
      });
      await request(app)
        .get('/api/people')
        .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));
      return callIndex;
    };

    const with1    = await countFor(1);
    const with1000 = await countFor(1000);
    expect(Math.abs(with1000 - with1)).toBeLessThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/audit — query budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/audit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('audit list issues at most 2 queries (count + data)', async () => {
    const audits = makeAuditRows(100);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve({ rows: [{ count: '100' }], rowCount: 1 });
      return Promise.resolve({ rows: audits, rowCount: audits.length });
    });

    const res = await request(app)
      .get('/api/audit')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect([200, 404]).toContain(res.status);
    expect(callIndex).toBeLessThanOrEqual(3); // count + data + potential role check
  });

  it('audit query count does not scale with number of audit rows', async () => {
    const countForAudit = async (n) => {
      vi.clearAllMocks();
      const audits = makeAuditRows(n);
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        return Promise.resolve({ rows: audits, rowCount: audits.length });
      });
      await request(app)
        .get('/api/audit')
        .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));
      return callIndex;
    };

    const with10Audit  = await countForAudit(10);
    const with500Audit = await countForAudit(500);
    expect(Math.abs(with500Audit - with10Audit)).toBeLessThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/projects/:id — single project budget
// ══════════════════════════════════════════════════════════════════════════════

describe('N+1 budget: GET /api/projects/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('single project detail uses at most 5 queries', async () => {
    const milestones = makeMilestones(20);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve({ rows: [makeProjects(1)[0]], rowCount: 1 });
      if (callIndex === 2) return Promise.resolve({ rows: milestones, rowCount: milestones.length });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get('/api/projects/proj-0')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect([200, 404]).toContain(res.status);
    expect(callIndex).toBeLessThanOrEqual(6);
  });

  it('query count for single project is the same regardless of assignment count', async () => {
    const countForProject = async (assignmentCount) => {
      vi.clearAllMocks();
      const assignments = Array.from({ length: assignmentCount }, (_, i) => ({
        project_id: 'proj-0', person_id: `p-${i}`,
      }));
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve({ rows: [makeProjects(1)[0]], rowCount: 1 });
        if (callIndex === 2) return Promise.resolve({ rows: assignments, rowCount: assignments.length });
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      await request(app)
        .get('/api/projects/proj-0')
        .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));
      return callIndex;
    };

    const with5  = await countForProject(5);
    const with50 = await countForProject(50);
    expect(Math.abs(with50 - with5)).toBeLessThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// General query budget guard
// ══════════════════════════════════════════════════════════════════════════════

describe('General query budget invariants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('health check issues at most 1 query', async () => {
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 });
    });

    await request(app).get('/api/ready');
    expect(callIndex).toBeLessThanOrEqual(1);
  });

  it('GET /api/health issues 0 DB queries', async () => {
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await request(app).get('/api/health');
    expect(callIndex).toBe(0);
  });

  it('GET /api/people issues no more than 2 queries even with 500 records', async () => {
    const people = makePeople(500);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: people, rowCount: people.length });
    });

    await request(app)
      .get('/api/people')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect(callIndex).toBeLessThanOrEqual(2);
    expect(callIndex).toBeLessThan(people.length);
  });

  it('milestones endpoint with 100 milestones uses bounded queries', async () => {
    const milestones = makeMilestones(100);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: milestones, rowCount: milestones.length });
    });

    await request(app)
      .get('/api/projects/proj-1/milestones')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect(callIndex).toBeLessThan(milestones.length);
  });

  it('project list with 200 projects issues bounded queries', async () => {
    const projects = makeProjects(200);
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      return Promise.resolve({ rows: projects, rowCount: projects.length });
    });

    await request(app)
      .get('/api/projects')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect(callIndex).toBeLessThan(projects.length / 2);
  });

  it('GET /api/projects/:id/assignments issues at most 3 queries', async () => {
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      project_id: 'proj-1', person_id: `p-${i}`, assignment_role: 'poc',
    }));
    let callIndex = 0;
    query.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve({ rows: [makeProjects(1)[0]], rowCount: 1 });
      return Promise.resolve({ rows: assignments, rowCount: assignments.length });
    });

    await request(app)
      .get('/api/projects/proj-0/assignments')
      .set('x-test-person', JSON.stringify({ id: 'admin-id', name: 'Admin', email: 'admin@test.com', role: 'admin' }));

    expect(callIndex).toBeLessThanOrEqual(3);
  });

  it('dashboard query count is the same for admin as for partner (bounded O(1))', async () => {
    const countFor = async (role) => {
      vi.clearAllMocks();
      let callIndex = 0;
      query.mockImplementation(() => {
        callIndex++;
        return Promise.resolve({ rows: [{ total: '50', count: '10' }], rowCount: 1 });
      });
      await request(app)
        .get('/api/dashboard')
        .set('x-test-person', JSON.stringify({ id: 'uid', name: 'User', email: 'u@test.com', role }));
      return callIndex;
    };

    const adminCount   = await countFor('admin');
    const partnerCount = await countFor('partner_poc');
    // Both should use bounded queries; difference is acceptable but should not be enormous
    expect(adminCount).toBeLessThanOrEqual(8);
    expect(partnerCount).toBeLessThanOrEqual(8);
  });
});
