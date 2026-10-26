DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'approvals'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE approvals DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE approvals ADD CONSTRAINT approvals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS rejected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by      UUID REFERENCES people (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS overridden_by    UUID REFERENCES people (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_reason  TEXT;
