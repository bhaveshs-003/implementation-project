CREATE TABLE IF NOT EXISTS milestone_comments (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID        NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
    sub_task_id  UUID        REFERENCES sub_tasks (id) ON DELETE CASCADE,
    author_id    UUID        NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
    body         TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestone_comments_milestone ON milestone_comments (milestone_id, created_at);
