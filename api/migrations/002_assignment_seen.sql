ALTER TABLE project_assignments ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;

-- Existing assignments are treated as already seen so they don't all light up.
UPDATE project_assignments SET seen_at = assigned_at WHERE seen_at IS NULL;
