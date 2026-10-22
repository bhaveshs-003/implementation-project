-- =============================================================================
-- Functional Tool – Development / Test Seed Data
-- Seed: 001_seed.sql
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING throughout.
-- UUIDs are hardcoded for predictable test references.
-- NO real credentials or passwords are stored here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- people
-- Pattern: 00000000-0000-0000-0000-0000000000XX
--   01-02  admins
--   03-04  partner POCs
--   05-07  company resources (no login)
-- user_id values are placeholder UUIDs; real values come from Supabase Auth.
-- ---------------------------------------------------------------------------
INSERT INTO people (id, name, email, job_title, role, user_id)
VALUES
    -- Admins
    (
        '00000000-0000-0000-0000-000000000001',
        'Alice Sharma',
        'alice.sharma@functionalool.internal',
        'Delivery Manager',
        'admin',
        'aaaaaaaa-0000-0000-0000-000000000001'   -- placeholder Supabase Auth UID
    ),
    (
        '00000000-0000-0000-0000-000000000002',
        'Bob Nair',
        'bob.nair@functionaltool.internal',
        'Project Director',
        'admin',
        'aaaaaaaa-0000-0000-0000-000000000002'
    ),

    -- Partner POCs
    (
        '00000000-0000-0000-0000-000000000003',
        'Carol Menon',
        'carol.menon@partner-alpha.example.com',
        'Technical Lead',
        'partner_poc',
        'bbbbbbbb-0000-0000-0000-000000000003'
    ),
    (
        '00000000-0000-0000-0000-000000000004',
        'David Rajan',
        'david.rajan@partner-beta.example.com',
        'Project Coordinator',
        'partner_poc',
        'bbbbbbbb-0000-0000-0000-000000000004'
    ),

    -- Company resources (no login – user_id NULL, email NULL)
    (
        '00000000-0000-0000-0000-000000000005',
        'Priya Krishnan',
        NULL,
        'Senior Developer',
        'resource',
        NULL
    ),
    (
        '00000000-0000-0000-0000-000000000006',
        'Arjun Pillai',
        NULL,
        'QA Engineer',
        'resource',
        NULL
    ),
    (
        '00000000-0000-0000-0000-000000000007',
        'Meena Suresh',
        NULL,
        'UI/UX Designer',
        'resource',
        NULL
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- projects
-- P01 – not_started
-- P02 – in_progress
-- P03 – completed
-- ---------------------------------------------------------------------------
INSERT INTO projects (
    id, code, title, type, status, description,
    company_start_date, company_end_date,
    partner_start_date, partner_end_date,
    approved_start_date, approved_end_date,
    created_by
)
VALUES
    (
        '10000000-0000-0000-0000-000000000001',
        'PROJ-001',
        'Customer Portal Redesign',
        'Web Development',
        'not_started',
        'Complete redesign of the client-facing customer portal using React and Node.',
        '2026-11-01', '2027-03-31',
        '2026-11-01', '2027-04-15',
        '2026-11-01', '2027-03-31',
        '00000000-0000-0000-0000-000000000001'
    ),
    (
        '10000000-0000-0000-0000-000000000002',
        'PROJ-002',
        'Data Pipeline Modernisation',
        'Data Engineering',
        'in_progress',
        'Migrate legacy ETL pipelines to Apache Kafka and AWS Glue.',
        '2026-08-01', '2026-12-31',
        '2026-08-01', '2027-01-15',
        '2026-08-01', '2026-12-31',
        '00000000-0000-0000-0000-000000000001'
    ),
    (
        '10000000-0000-0000-0000-000000000003',
        'PROJ-003',
        'Mobile Banking App',
        'Mobile Development',
        'completed',
        'React Native banking application for iOS and Android.',
        '2026-01-15', '2026-09-30',
        '2026-01-15', '2026-10-15',
        '2026-01-15', '2026-09-30',
        '00000000-0000-0000-0000-000000000002'
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- project_assignments
-- ---------------------------------------------------------------------------
INSERT INTO project_assignments (id, project_id, person_id, assignment_role)
VALUES
    -- PROJ-001
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'poc'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'resource'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'resource'),

    -- PROJ-002
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'poc'),
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'resource'),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000006', 'resource'),

    -- PROJ-003
    ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'poc'),
    ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'resource')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- milestones
-- PROJ-001: 2 milestones (not_started)
-- PROJ-002: 3 milestones (mix of in_progress/not_started)
-- PROJ-003: 3 milestones (completed)
-- ---------------------------------------------------------------------------
INSERT INTO milestones (
    id, project_id, title, status,
    company_start_date, company_end_date,
    partner_start_date, partner_end_date,
    approved_start_date, approved_end_date,
    completed_at, on_time, delay_side, delay_reason,
    order_index
)
VALUES
    -- PROJ-001 milestones
    (
        '30000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        'Discovery & Requirements',
        'not_started',
        '2026-11-01', '2026-11-30',
        '2026-11-01', '2026-12-07',
        '2026-11-01', '2026-11-30',
        NULL, NULL, NULL, NULL, 1
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000001',
        'UI/UX Design Mockups',
        'not_started',
        '2026-12-01', '2026-12-31',
        '2026-12-01', '2027-01-07',
        '2026-12-01', '2026-12-31',
        NULL, NULL, NULL, NULL, 2
    ),

    -- PROJ-002 milestones
    (
        '30000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000002',
        'Infrastructure Setup',
        'completed',
        '2026-08-01', '2026-08-31',
        '2026-08-01', '2026-09-07',
        '2026-08-01', '2026-08-31',
        '2026-08-28 17:00:00+05:30',
        TRUE, NULL, NULL, 1
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '10000000-0000-0000-0000-000000000002',
        'Source System Connectors',
        'in_progress',
        '2026-09-01', '2026-10-31',
        '2026-09-01', '2026-11-14',
        '2026-09-01', '2026-10-31',
        NULL, NULL, NULL, NULL, 2
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '10000000-0000-0000-0000-000000000002',
        'Data Validation & Testing',
        'not_started',
        '2026-11-01', '2026-11-30',
        '2026-11-01', '2026-12-14',
        '2026-11-01', '2026-11-30',
        NULL, NULL, NULL, NULL, 3
    ),

    -- PROJ-003 milestones (all completed)
    (
        '30000000-0000-0000-0000-000000000006',
        '10000000-0000-0000-0000-000000000003',
        'Authentication & Onboarding',
        'completed',
        '2026-01-15', '2026-03-31',
        '2026-01-15', '2026-04-07',
        '2026-01-15', '2026-03-31',
        '2026-03-28 18:30:00+05:30',
        TRUE, NULL, NULL, 1
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '10000000-0000-0000-0000-000000000003',
        'Core Banking Features',
        'completed',
        '2026-04-01', '2026-06-30',
        '2026-04-01', '2026-07-15',
        '2026-04-01', '2026-06-30',
        '2026-07-10 15:00:00+05:30',
        FALSE,
        'partner',
        'Third-party payment gateway integration took longer than estimated due to API documentation gaps.',
        2
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '10000000-0000-0000-0000-000000000003',
        'UAT & Go-Live',
        'completed',
        '2026-07-15', '2026-09-30',
        '2026-07-15', '2026-10-07',
        '2026-07-15', '2026-09-30',
        '2026-09-25 17:00:00+05:30',
        TRUE, NULL, NULL, 3
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- sub_tasks
-- ---------------------------------------------------------------------------
INSERT INTO sub_tasks (id, milestone_id, title, status, completed_at, order_index)
VALUES
    -- PROJ-001 / M1 – Discovery
    ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Stakeholder interviews', 'open', NULL, 1),
    ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Current-state audit', 'open', NULL, 2),

    -- PROJ-001 / M2 – UI/UX
    ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'Wireframes – portal home', 'open', NULL, 1),
    ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'Design system tokens', 'open', NULL, 2),

    -- PROJ-002 / M1 – Infra (completed)
    ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000003', 'Provision Kafka cluster on AWS MSK', 'completed', '2026-08-15 14:00:00+05:30', 1),
    ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000003', 'Configure AWS Glue catalogue', 'completed', '2026-08-22 11:00:00+05:30', 2),
    ('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000003', 'IAM roles and VPC networking', 'completed', '2026-08-27 16:30:00+05:30', 3),

    -- PROJ-002 / M2 – Connectors (in_progress)
    ('40000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000004', 'Oracle CDC connector', 'completed', '2026-09-20 10:00:00+05:30', 1),
    ('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000004', 'PostgreSQL Debezium connector', 'open', NULL, 2),
    ('40000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000004', 'Schema registry setup', 'open', NULL, 3),

    -- PROJ-003 / M1 – Auth (completed)
    ('40000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000006', 'OTP-based login flow', 'completed', '2026-02-10 09:00:00+05:30', 1),
    ('40000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000006', 'KYC document upload', 'completed', '2026-03-05 14:00:00+05:30', 2),

    -- PROJ-003 / M2 – Core Banking (completed, had delay)
    ('40000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000007', 'Fund transfer module', 'completed', '2026-05-30 17:00:00+05:30', 1),
    ('40000000-0000-0000-0000-000000000014', '30000000-0000-0000-0000-000000000007', 'Payment gateway integration', 'completed', '2026-07-08 16:00:00+05:30', 2),

    -- PROJ-003 / M3 – UAT (completed)
    ('40000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000008', 'SIT completion', 'completed', '2026-08-10 12:00:00+05:30', 1),
    ('40000000-0000-0000-0000-000000000016', '30000000-0000-0000-0000-000000000008', 'UAT sign-off', 'completed', '2026-09-20 15:00:00+05:30', 2)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- approvals
-- One per milestone, for milestones that have been completed.
-- ---------------------------------------------------------------------------
INSERT INTO approvals (
    id, milestone_id, status,
    submitted_at, submitted_by,
    approved_at, approved_by,
    rating, comment
)
VALUES
    -- PROJ-002 / M1 – approved
    (
        '50000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000003',
        'approved',
        '2026-08-28 18:00:00+05:30',
        '00000000-0000-0000-0000-000000000004',   -- partner POC David
        '2026-08-29 10:00:00+05:30',
        '00000000-0000-0000-0000-000000000001',   -- admin Alice
        5,
        'Infrastructure provisioned cleanly and ahead of schedule. Excellent work.'
    ),

    -- PROJ-003 / M1 – approved
    (
        '50000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000006',
        'approved',
        '2026-03-28 20:00:00+05:30',
        '00000000-0000-0000-0000-000000000003',   -- partner POC Carol
        '2026-03-30 11:00:00+05:30',
        '00000000-0000-0000-0000-000000000002',   -- admin Bob
        4,
        'Auth flow delivered on time. Minor UX feedback incorporated.'
    ),

    -- PROJ-003 / M2 – approved (completed late)
    (
        '50000000-0000-0000-0000-000000000003',
        '30000000-0000-0000-0000-000000000007',
        'approved',
        '2026-07-10 17:00:00+05:30',
        '00000000-0000-0000-0000-000000000003',
        '2026-07-12 09:30:00+05:30',
        '00000000-0000-0000-0000-000000000002',
        3,
        'Milestone delivered but payment gateway integration caused a 10-day overrun. Delay accepted.'
    ),

    -- PROJ-003 / M3 – approved
    (
        '50000000-0000-0000-0000-000000000004',
        '30000000-0000-0000-0000-000000000008',
        'approved',
        '2026-09-25 19:00:00+05:30',
        '00000000-0000-0000-0000-000000000003',
        '2026-09-26 10:00:00+05:30',
        '00000000-0000-0000-0000-000000000001',
        5,
        'Smooth UAT and go-live. Client very satisfied.'
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- attachments
-- Unclaimed attachment uploaded by partner POC, later claimed by a message.
-- claimed_by_message_id will be set after delay_messages insert below.
-- ---------------------------------------------------------------------------
INSERT INTO attachments (
    id, storage_path, original_name, mime_type, size_bytes,
    claimed, claimed_at, claimed_by_message_id, created_by
)
VALUES
    (
        '60000000-0000-0000-0000-000000000001',
        'delays/60000000-0000-0000-0000-000000000001',
        'gateway_vendor_response.pdf',
        'application/pdf',
        204800,
        TRUE,
        '2026-07-05 12:00:00+05:30',
        NULL,   -- updated after delay_messages insert
        '00000000-0000-0000-0000-000000000003'
    ),
    (
        '60000000-0000-0000-0000-000000000002',
        'delays/60000000-0000-0000-0000-000000000002',
        'revised_timeline.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        51200,
        FALSE,
        NULL,
        NULL,
        '00000000-0000-0000-0000-000000000004'
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- delays
-- D1: accepted delay on PROJ-003 / M2 (payment gateway)
-- D2: pending delay on PROJ-002 / M2 sub-task
-- ---------------------------------------------------------------------------
INSERT INTO delays (
    id, milestone_id, sub_task_id, status, side, reason,
    created_at, decided_at, decided_by
)
VALUES
    (
        '70000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000007',   -- PROJ-003 / Core Banking
        '40000000-0000-0000-0000-000000000014',   -- Payment gateway sub-task
        'accepted',
        'partner',
        'Payment gateway vendor API documentation was incomplete. Multiple clarification rounds with the vendor caused a 10-day overrun.',
        '2026-07-01 09:00:00+05:30',
        '2026-07-12 09:30:00+05:30',
        '00000000-0000-0000-0000-000000000002'    -- decided by admin Bob
    ),
    (
        '70000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000004',   -- PROJ-002 / Source System Connectors
        '40000000-0000-0000-0000-000000000009',   -- PostgreSQL Debezium sub-task
        'pending',
        'company',
        'Database access credentials for the source PostgreSQL instance have not been provided by the company team.',
        '2026-10-10 11:00:00+05:30',
        NULL,
        NULL
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- delay_messages
-- Thread for D1 (accepted): initial report → company denial → partner rebuttal → accepted
-- Thread for D2 (pending):  initial report only
-- ---------------------------------------------------------------------------
INSERT INTO delay_messages (
    id, delay_id, author_id, body, action, attachment_id, created_at
)
VALUES
    -- D1 Thread
    (
        '80000000-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003',   -- Carol (partner POC)
        'The payment gateway vendor provided incomplete Swagger documentation. We raised 14 separate clarification tickets between 2026-05-01 and 2026-06-20. Please see the attached vendor response for reference.',
        'reply',
        '60000000-0000-0000-0000-000000000001',   -- PDF attachment
        '2026-07-01 09:30:00+05:30'
    ),
    (
        '80000000-0000-0000-0000-000000000002',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',   -- Alice (admin)
        'Initial review suggests the timeline should have accounted for vendor risk. Marking as denied pending further evidence.',
        'deny',
        NULL,
        '2026-07-03 14:00:00+05:30'
    ),
    (
        '80000000-0000-0000-0000-000000000003',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003',   -- Carol
        'We have provided all vendor correspondence. The risk was not foreseeable at the time of planning as the gateway was recommended by the client. We request reconsideration.',
        'reply',
        NULL,
        '2026-07-05 11:00:00+05:30'
    ),
    (
        '80000000-0000-0000-0000-000000000004',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',   -- Bob (admin)
        'After reviewing the vendor correspondence and the approval milestone sign-off, we accept the delay. The 10-day overrun is noted in the project record.',
        'accept',
        NULL,
        '2026-07-12 09:30:00+05:30'
    ),

    -- D2 Thread (pending – only one message so far)
    (
        '80000000-0000-0000-0000-000000000005',
        '70000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000004',   -- David (partner POC)
        'We are blocked on the PostgreSQL Debezium connector because the source DB credentials have not been shared by the company team despite 3 follow-up emails since 2026-10-05. Raising as a formal delay.',
        'reply',
        NULL,
        '2026-10-10 11:15:00+05:30'
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Update attachment claim – link to the first delay message
-- ---------------------------------------------------------------------------
UPDATE attachments
SET
    claimed              = TRUE,
    claimed_at           = '2026-07-01 09:30:00+05:30',
    claimed_by_message_id = '80000000-0000-0000-0000-000000000001'
WHERE
    id = '60000000-0000-0000-0000-000000000001'
    AND claimed_by_message_id IS NULL;

-- ---------------------------------------------------------------------------
-- audit_log – sample entries for key state transitions
-- ---------------------------------------------------------------------------
INSERT INTO audit_log (
    id, event_type, entity_type, entity_id,
    actor_id, actor_role,
    old_values, new_values, meta, created_at
)
VALUES
    -- Project status: not_started → in_progress (PROJ-002)
    (
        '90000000-0000-0000-0000-000000000001',
        'project.status_changed',
        'project',
        '10000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        'admin',
        '{"status": "not_started"}',
        '{"status": "in_progress"}',
        '{"triggered_by": "admin_dashboard"}',
        '2026-08-01 09:00:00+05:30'
    ),

    -- Milestone completed (PROJ-002 / M1 – Infra)
    (
        '90000000-0000-0000-0000-000000000002',
        'milestone.completed',
        'milestone',
        '30000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004',
        'partner_poc',
        '{"status": "in_progress"}',
        '{"status": "completed", "on_time": true}',
        '{}',
        '2026-08-28 17:00:00+05:30'
    ),

    -- Approval created (PROJ-002 / M1)
    (
        '90000000-0000-0000-0000-000000000003',
        'approval.created',
        'approval',
        '50000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000004',
        'partner_poc',
        NULL,
        '{"status": "pending"}',
        '{}',
        '2026-08-28 18:00:00+05:30'
    ),

    -- Approval approved
    (
        '90000000-0000-0000-0000-000000000004',
        'approval.approved',
        'approval',
        '50000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'admin',
        '{"status": "pending"}',
        '{"status": "approved", "rating": 5}',
        '{}',
        '2026-08-29 10:00:00+05:30'
    ),

    -- Delay created (D1)
    (
        '90000000-0000-0000-0000-000000000005',
        'delay.created',
        'delay',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003',
        'partner_poc',
        NULL,
        '{"status": "pending", "side": "partner"}',
        '{"sub_task_id": "40000000-0000-0000-0000-000000000014"}',
        '2026-07-01 09:00:00+05:30'
    ),

    -- Delay denied (D1)
    (
        '90000000-0000-0000-0000-000000000006',
        'delay.denied',
        'delay',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'admin',
        '{"status": "pending"}',
        '{"status": "denied"}',
        '{}',
        '2026-07-03 14:00:00+05:30'
    ),

    -- Delay accepted (D1)
    (
        '90000000-0000-0000-0000-000000000007',
        'delay.accepted',
        'delay',
        '70000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        'admin',
        '{"status": "denied"}',
        '{"status": "accepted"}',
        '{}',
        '2026-07-12 09:30:00+05:30'
    )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- rate_limit_attempts – a handful of realistic test rows
-- ---------------------------------------------------------------------------
INSERT INTO rate_limit_attempts (id, email, ip, attempted_at)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'alice.sharma@functionalool.internal', '203.0.113.10', NOW() - INTERVAL '5 minutes'),
    ('a0000000-0000-0000-0000-000000000002', 'alice.sharma@functionalool.internal', '203.0.113.10', NOW() - INTERVAL '4 minutes'),
    ('a0000000-0000-0000-0000-000000000003', 'bob.nair@functionaltool.internal',    '203.0.113.11', NOW() - INTERVAL '3 minutes'),
    ('a0000000-0000-0000-0000-000000000004', NULL,                                  '198.51.100.5', NOW() - INTERVAL '2 minutes'),
    ('a0000000-0000-0000-0000-000000000005', NULL,                                  '198.51.100.5', NOW() - INTERVAL '1 minute')
ON CONFLICT (id) DO NOTHING;
