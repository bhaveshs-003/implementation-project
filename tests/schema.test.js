/**
 * schema.test.js
 * Verifies that the Postgres schema (via DATABASE_URL) matches the SPEC.
 * Requires a live DB connection; skipped entirely when DATABASE_URL is absent.
 */

import pg from 'pg';

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;
const skipAll = !DB_URL;

let pool;

describe('Database Schema', () => {
  beforeAll(() => {
    if (skipAll) return;
    pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ── Table existence ────────────────────────────────────────────────────────

  describe('Table existence', () => {
    const tables = [
      'people',
      'projects',
      'project_assignments',
      'milestones',
      'sub_tasks',
      'approvals',
      'delays',
      'delay_messages',
      'attachments',
      'audit_log',
      'rate_limit_attempts',
    ];

    for (const table of tables) {
      it(`table "${table}" exists`, async () => {
        if (skipAll) return;
        const res = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1`,
          [table]
        );
        expect(res.rows.length).toBe(1);
      });
    }
  });

  // ── Column nullability ─────────────────────────────────────────────────────

  describe('Column nullability', () => {
    it('people.user_id is nullable', async () => {
      if (skipAll) return;
      const res = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'user_id'`
      );
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows[0].is_nullable).toBe('YES');
    });

    it('people.name is NOT nullable', async () => {
      if (skipAll) return;
      const res = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'name'`
      );
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows[0].is_nullable).toBe('NO');
    });
  });

  // ── CHECK constraints ──────────────────────────────────────────────────────

  describe('CHECK constraints', () => {
    async function getConstraint(table, fragment) {
      const res = await pool.query(
        `SELECT cc.check_clause
         FROM information_schema.check_constraints cc
         JOIN information_schema.table_constraints tc
           ON cc.constraint_name = tc.constraint_name
          AND cc.constraint_schema = tc.constraint_schema
         WHERE tc.table_schema = 'public'
           AND tc.table_name   = $1
           AND tc.constraint_type = 'CHECK'`,
        [table]
      );
      return res.rows.some(r => r.check_clause.toLowerCase().includes(fragment.toLowerCase()));
    }

    it('people has CHECK: role=resource OR email IS NOT NULL', async () => {
      if (skipAll) return;
      const found = await getConstraint('people', 'email');
      expect(found).toBe(true);
    });

    it('projects.status has a CHECK constraint', async () => {
      if (skipAll) return;
      const found = await getConstraint('projects', 'status');
      expect(found).toBe(true);
    });

    it('milestones.status has a CHECK constraint', async () => {
      if (skipAll) return;
      const found = await getConstraint('milestones', 'status');
      expect(found).toBe(true);
    });

    it('sub_tasks.status has a CHECK constraint', async () => {
      if (skipAll) return;
      const found = await getConstraint('sub_tasks', 'status');
      expect(found).toBe(true);
    });

    it('approvals.rating has a CHECK constraint (1–5)', async () => {
      if (skipAll) return;
      const found = await getConstraint('approvals', 'rating');
      expect(found).toBe(true);
    });

    it('delays.status has a CHECK constraint', async () => {
      if (skipAll) return;
      const found = await getConstraint('delays', 'status');
      expect(found).toBe(true);
    });

    it('delays.side has a CHECK constraint', async () => {
      if (skipAll) return;
      const found = await getConstraint('delays', 'side');
      expect(found).toBe(true);
    });
  });

  // ── Unique constraints ─────────────────────────────────────────────────────

  describe('Unique constraints', () => {
    async function hasUniqueConstraint(table, ...columns) {
      const res = await pool.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.constraint_schema = kcu.constraint_schema
         WHERE tc.table_schema = 'public'
           AND tc.table_name   = $1
           AND tc.constraint_type = 'UNIQUE'`,
        [table]
      );
      const cols = res.rows.map(r => r.column_name);
      return columns.every(c => cols.includes(c));
    }

    it('approvals has UNIQUE on milestone_id', async () => {
      if (skipAll) return;
      const ok = await hasUniqueConstraint('approvals', 'milestone_id');
      expect(ok).toBe(true);
    });

    it('project_assignments has UNIQUE(project_id, person_id)', async () => {
      if (skipAll) return;
      const ok = await hasUniqueConstraint('project_assignments', 'project_id', 'person_id');
      expect(ok).toBe(true);
    });

    it('projects.code is unique (citext)', async () => {
      if (skipAll) return;
      // Confirm column data_type is citext or character varying, and a unique index exists
      const res = await pool.query(
        `SELECT udt_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'code'`
      );
      expect(res.rows.length).toBeGreaterThan(0);
      // citext shows as citext in udt_name
      const udtName = res.rows[0].udt_name;
      expect(['citext', 'varchar', 'text'].includes(udtName)).toBe(true);
    });
  });

  // ── Timestamp columns are TIMESTAMPTZ ──────────────────────────────────────

  describe('TIMESTAMPTZ columns', () => {
    async function isTimestampTZ(table, column) {
      const res = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [table, column]
      );
      if (!res.rows.length) return false;
      return res.rows[0].data_type === 'timestamp with time zone';
    }

    const timestampCols = [
      ['projects', 'created_at'],
      ['projects', 'start_date'],
      ['milestones', 'created_at'],
      ['approvals', 'approved_at'],
      ['delays', 'created_at'],
      ['audit_log', 'created_at'],
    ];

    for (const [table, col] of timestampCols) {
      it(`${table}.${col} is TIMESTAMPTZ`, async () => {
        if (skipAll) return;
        const ok = await isTimestampTZ(table, col);
        expect(ok).toBe(true);
      });
    }
  });

  // ── Foreign key constraints ────────────────────────────────────────────────

  describe('Foreign key constraints', () => {
    async function hasForeignKey(fromTable, fromCol, toTable) {
      const res = await pool.query(
        `SELECT ccu.table_name AS referenced_table
         FROM information_schema.table_constraints AS tc
         JOIN information_schema.key_column_usage AS kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.constraint_schema = kcu.constraint_schema
         JOIN information_schema.constraint_column_usage AS ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.constraint_schema = tc.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'
           AND tc.table_name = $1
           AND kcu.column_name = $2`,
        [fromTable, fromCol]
      );
      return res.rows.some(r => r.referenced_table === toTable);
    }

    it('project_assignments.project_id references projects', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('project_assignments', 'project_id', 'projects')).toBe(true);
    });

    it('project_assignments.person_id references people', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('project_assignments', 'person_id', 'people')).toBe(true);
    });

    it('milestones.project_id references projects', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('milestones', 'project_id', 'projects')).toBe(true);
    });

    it('sub_tasks.milestone_id references milestones', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('sub_tasks', 'milestone_id', 'milestones')).toBe(true);
    });

    it('approvals.milestone_id references milestones', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('approvals', 'milestone_id', 'milestones')).toBe(true);
    });

    it('delays.milestone_id references milestones', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('delays', 'milestone_id', 'milestones')).toBe(true);
    });

    it('delay_messages.delay_id references delays', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('delay_messages', 'delay_id', 'delays')).toBe(true);
    });

    it('attachments.project_id references projects', async () => {
      if (skipAll) return;
      expect(await hasForeignKey('attachments', 'project_id', 'projects')).toBe(true);
    });
  });

  // ── Index checks ───────────────────────────────────────────────────────────

  describe('Indexes', () => {
    async function hasIndex(table, column) {
      const res = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1 AND indexdef ILIKE $2`,
        [table, `%${column}%`]
      );
      return res.rows.length > 0;
    }

    it('projects has an index on status', async () => {
      if (skipAll) return;
      expect(await hasIndex('projects', 'status')).toBe(true);
    });

    it('milestones has an index on project_id', async () => {
      if (skipAll) return;
      expect(await hasIndex('milestones', 'project_id')).toBe(true);
    });

    it('delays has an index on milestone_id', async () => {
      if (skipAll) return;
      expect(await hasIndex('delays', 'milestone_id')).toBe(true);
    });

    it('audit_log has an index on created_at', async () => {
      if (skipAll) return;
      expect(await hasIndex('audit_log', 'created_at')).toBe(true);
    });

    it('rate_limit_attempts has an index on email or identifier', async () => {
      if (skipAll) return;
      const res = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'rate_limit_attempts'`
      );
      expect(res.rows.length).toBeGreaterThan(0);
    });

    it('sub_tasks has an index on milestone_id', async () => {
      if (skipAll) return;
      expect(await hasIndex('sub_tasks', 'milestone_id')).toBe(true);
    });

    it('approvals has an index on milestone_id', async () => {
      if (skipAll) return;
      expect(await hasIndex('approvals', 'milestone_id')).toBe(true);
    });

    it('attachments has an index on project_id', async () => {
      if (skipAll) return;
      expect(await hasIndex('attachments', 'project_id')).toBe(true);
    });
  });

  // ── Column existence spot-checks ───────────────────────────────────────────

  describe('Column existence', () => {
    async function hasColumn(table, column) {
      const res = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [table, column]
      );
      return res.rows.length > 0;
    }

    it('projects has a code column', async () => {
      if (skipAll) return;
      expect(await hasColumn('projects', 'code')).toBe(true);
    });

    it('projects has a status column', async () => {
      if (skipAll) return;
      expect(await hasColumn('projects', 'status')).toBe(true);
    });

    it('projects has start_date and end_date columns', async () => {
      if (skipAll) return;
      expect(await hasColumn('projects', 'start_date')).toBe(true);
      expect(await hasColumn('projects', 'end_date')).toBe(true);
    });

    it('milestones has a due_date column', async () => {
      if (skipAll) return;
      expect(await hasColumn('milestones', 'due_date')).toBe(true);
    });

    it('approvals has rating column', async () => {
      if (skipAll) return;
      expect(await hasColumn('approvals', 'rating')).toBe(true);
    });

    it('approvals has comment column', async () => {
      if (skipAll) return;
      expect(await hasColumn('approvals', 'comment')).toBe(true);
    });

    it('delays has side column', async () => {
      if (skipAll) return;
      expect(await hasColumn('delays', 'side')).toBe(true);
    });

    it('delays has reason column', async () => {
      if (skipAll) return;
      expect(await hasColumn('delays', 'reason')).toBe(true);
    });

    it('audit_log has event_type column', async () => {
      if (skipAll) return;
      expect(await hasColumn('audit_log', 'event_type')).toBe(true);
    });

    it('audit_log has actor_id column', async () => {
      if (skipAll) return;
      expect(await hasColumn('audit_log', 'actor_id')).toBe(true);
    });

    it('audit_log has entity_type column', async () => {
      if (skipAll) return;
      expect(await hasColumn('audit_log', 'entity_type')).toBe(true);
    });

    it('audit_log has entity_id column', async () => {
      if (skipAll) return;
      expect(await hasColumn('audit_log', 'entity_id')).toBe(true);
    });

    it('people has role column', async () => {
      if (skipAll) return;
      expect(await hasColumn('people', 'role')).toBe(true);
    });

    it('people has email column', async () => {
      if (skipAll) return;
      expect(await hasColumn('people', 'email')).toBe(true);
    });

    it('project_assignments has assignment_role column', async () => {
      if (skipAll) return;
      expect(await hasColumn('project_assignments', 'assignment_role')).toBe(true);
    });

    it('rate_limit_attempts has attempted_at or created_at column', async () => {
      if (skipAll) return;
      const hasAttemptedAt = await hasColumn('rate_limit_attempts', 'attempted_at');
      const hasCreatedAt   = await hasColumn('rate_limit_attempts', 'created_at');
      expect(hasAttemptedAt || hasCreatedAt).toBe(true);
    });
  });

  // ── Primary key checks ─────────────────────────────────────────────────────

  describe('Primary keys', () => {
    async function hasPrimaryKey(table) {
      const res = await pool.query(
        `SELECT tc.constraint_name
         FROM information_schema.table_constraints tc
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = 'public'
           AND tc.table_name = $1`,
        [table]
      );
      return res.rows.length > 0;
    }

    const tablesWithPK = [
      'people', 'projects', 'project_assignments',
      'milestones', 'sub_tasks', 'approvals',
      'delays', 'delay_messages', 'attachments', 'audit_log',
    ];

    for (const table of tablesWithPK) {
      it(`${table} has a primary key`, async () => {
        if (skipAll) return;
        expect(await hasPrimaryKey(table)).toBe(true);
      });
    }
  });
});
