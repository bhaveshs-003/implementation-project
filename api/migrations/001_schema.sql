-- =============================================================================
-- Functional Tool – Full Database Schema
-- Migration: 001_schema.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------------------
-- people
-- Stores all human actors: admins, partner POCs, and company resources.
-- Resources have no login (user_id is null, email not required).
-- Admins and partner_poc must have an email address.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    email       CITEXT      UNIQUE,
    job_title   TEXT,
    role        TEXT        NOT NULL CHECK (role IN ('admin', 'partner_poc', 'resource')),
    user_id     UUID        UNIQUE,             -- Supabase Auth UID; NULL for resources
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Enforce: anyone who can sign in must have an email
    CONSTRAINT chk_people_email_required
        CHECK (
            role = 'resource'
            OR (email IS NOT NULL AND role IN ('admin', 'partner_poc'))
        )
);

-- ---------------------------------------------------------------------------
-- projects
-- code is case-insensitive unique via citext.
-- Status is one-way: not_started → in_progress → completed.
-- Soft-delete via deleted_at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code                CITEXT      NOT NULL UNIQUE,
    title               TEXT        NOT NULL,
    type                TEXT,
    status              TEXT        NOT NULL DEFAULT 'not_started'
                                    CHECK (status IN ('not_started', 'in_progress', 'completed')),
    description         TEXT,
    -- Date windows (company view, partner view, approved view)
    company_start_date  DATE,
    company_end_date    DATE,
    partner_start_date  DATE,
    partner_end_date    DATE,
    approved_start_date DATE,
    approved_end_date   DATE,
    created_by          UUID        REFERENCES people (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ             -- soft delete
);

-- ---------------------------------------------------------------------------
-- project_assignments
-- Links people to projects. A person can be a poc or resource on a project.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_assignments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    person_id       UUID        NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    assignment_role TEXT        NOT NULL CHECK (assignment_role IN ('poc', 'resource')),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (project_id, person_id)
);

-- ---------------------------------------------------------------------------
-- milestones
-- Belong to a project. Cascade-deleted when the project is deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestones (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    title               TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'not_started'
                                    CHECK (status IN ('not_started', 'in_progress', 'completed')),
    -- Date windows
    company_start_date  DATE,
    company_end_date    DATE,
    partner_start_date  DATE,
    partner_end_date    DATE,
    approved_start_date DATE,
    approved_end_date   DATE,
    completed_at        TIMESTAMPTZ,
    on_time             BOOLEAN,                -- NULL until completed
    delay_side          TEXT        CHECK (delay_side IN ('company', 'partner')),
    delay_reason        TEXT,
    order_index         INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- sub_tasks
-- Belong to a milestone. Cascade-deleted when the milestone is deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_tasks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID        NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
    title        TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'completed')),
    completed_at TIMESTAMPTZ,
    order_index  INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- approvals
-- One approval record per milestone (UNIQUE on milestone_id).
-- Tracks the approval workflow: pending → approved.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id  UUID        NOT NULL UNIQUE REFERENCES milestones (id) ON DELETE CASCADE,
    status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved')),
    submitted_at  TIMESTAMPTZ,
    submitted_by  UUID        REFERENCES people (id) ON DELETE SET NULL,
    approved_at   TIMESTAMPTZ,
    approved_by   UUID        REFERENCES people (id) ON DELETE SET NULL,
    rating        INTEGER     CHECK (rating BETWEEN 1 AND 5),   -- nullable
    comment       TEXT,                                          -- nullable
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- attachments
-- Files stored in Supabase Storage. Claimed when linked to a delay_message.
-- Defined BEFORE delay_messages to avoid circular FK; delay_messages will
-- reference attachments, and attachments will back-reference delay_messages
-- via ALTER TABLE after both tables exist.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_path         TEXT        NOT NULL UNIQUE,  -- Supabase Storage path / UUID key
    original_name        TEXT,
    mime_type            TEXT,
    size_bytes           BIGINT,
    claimed              BOOLEAN     NOT NULL DEFAULT FALSE,
    claimed_at           TIMESTAMPTZ,
    claimed_by_message_id UUID,                        -- FK added below after delay_messages
    created_by           UUID        REFERENCES people (id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- delays
-- Created when a milestone or sub_task is marked delayed at completion.
-- Status flow: pending → denied → accepted  OR  pending → accepted
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delays (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID        NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
    sub_task_id  UUID        REFERENCES sub_tasks (id) ON DELETE SET NULL,
    status       TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'denied', 'accepted')),
    side         TEXT        NOT NULL CHECK (side IN ('company', 'partner')),
    reason       TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at   TIMESTAMPTZ,
    decided_by   UUID        REFERENCES people (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- delay_messages
-- Threaded messages on a delay. action indicates workflow transitions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delay_messages (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    delay_id      UUID        NOT NULL REFERENCES delays (id) ON DELETE CASCADE,
    author_id     UUID        NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
    body          TEXT        NOT NULL,
    action        TEXT        CHECK (action IN ('deny', 'reply', 'accept')),
    attachment_id UUID        REFERENCES attachments (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-reference: attachments.claimed_by_message_id → delay_messages.id
ALTER TABLE attachments
    ADD CONSTRAINT fk_attachments_claimed_by_message
        FOREIGN KEY (claimed_by_message_id)
        REFERENCES delay_messages (id)
        ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- audit_log
-- Every state change is recorded. Retention: 2 years (enforced via policy /
-- a scheduled job outside this schema). actor_id nullable (system events).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  TEXT        NOT NULL,
    entity_type TEXT        NOT NULL,
    entity_id   UUID        NOT NULL,
    actor_id    UUID        REFERENCES people (id) ON DELETE SET NULL,
    actor_role  TEXT,
    old_values  JSONB,
    new_values  JSONB,
    meta        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- rate_limit_attempts
-- Postgres-backed rate limiting: 6 per email + 40 per IP per 15-minute window.
-- Records are cheap to insert; a cron job or partial index prunes old rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT,
    ip           TEXT        NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- projects
CREATE INDEX IF NOT EXISTS idx_projects_code   ON projects (lower(code));
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);

-- project_assignments
CREATE INDEX IF NOT EXISTS idx_proj_assign_project ON project_assignments (project_id);
CREATE INDEX IF NOT EXISTS idx_proj_assign_person  ON project_assignments (person_id);

-- milestones
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones (project_id);

-- sub_tasks
CREATE INDEX IF NOT EXISTS idx_sub_tasks_milestone ON sub_tasks (milestone_id);

-- approvals
CREATE INDEX IF NOT EXISTS idx_approvals_milestone ON approvals (milestone_id);

-- delays
CREATE INDEX IF NOT EXISTS idx_delays_milestone    ON delays (milestone_id);
CREATE INDEX IF NOT EXISTS idx_delays_sub_task     ON delays (sub_task_id);
CREATE INDEX IF NOT EXISTS idx_delays_status       ON delays (status);

-- delay_messages
CREATE INDEX IF NOT EXISTS idx_delay_messages_delay ON delay_messages (delay_id);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_created_at   ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity_type  ON audit_log (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity_id    ON audit_log (entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor_id     ON audit_log (actor_id);

-- rate_limit_attempts
CREATE INDEX IF NOT EXISTS idx_rla_email        ON rate_limit_attempts (email);
CREATE INDEX IF NOT EXISTS idx_rla_ip           ON rate_limit_attempts (ip);
CREATE INDEX IF NOT EXISTS idx_rla_attempted_at ON rate_limit_attempts (attempted_at);
