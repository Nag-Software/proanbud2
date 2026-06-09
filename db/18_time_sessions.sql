-- ==========================================
-- WORK SESSIONS (START / STOP TIMEFØRING)
-- ==========================================

ALTER TABLE IF EXISTS public.time_entries
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.time_entries
  ALTER COLUMN hours DROP NOT NULL;

ALTER TABLE IF EXISTS public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_hours_check;

ALTER TABLE IF EXISTS public.time_entries
  ADD CONSTRAINT time_entries_hours_check
  CHECK (
    (ended_at IS NULL AND hours IS NULL)
    OR (ended_at IS NOT NULL AND hours IS NOT NULL AND hours > 0 AND hours <= 24)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_time_session_per_user
  ON public.time_entries (user_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_company_ended
  ON public.time_entries (company_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_project_ended
  ON public.time_entries (project_id, ended_at DESC)
  WHERE ended_at IS NOT NULL;

-- Backfill started_at for legacy manual rows
UPDATE public.time_entries
SET started_at = COALESCE(started_at, created_at)
WHERE started_at IS NULL;

UPDATE public.time_entries
SET ended_at = COALESCE(ended_at, updated_at, created_at)
WHERE ended_at IS NULL AND hours IS NOT NULL;
