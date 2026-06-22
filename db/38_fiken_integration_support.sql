-- 38_fiken_integration_support.sql
-- Supporting infrastructure for the Fiken integration:
--   1. A provider-scoped global worker mutex (Fiken allows only ONE concurrent API
--      request per credential; repeated violations get the credential BANNED). A
--      module-level limiter is per-serverless-instance and cannot serialize across
--      overlapping cron + background-worker invocations, so we use a DB-backed,
--      TTL'd lock that every Fiken worker entrypoint must acquire.
--   2. Widen external_entity_links.sync_status to allow 'sent' and 'paid' (the
--      payments poller flips invoice links to 'paid'; this also fixes a latent
--      Tripletex path that already writes 'sent'/'paid').
--   3. An index for the payments reconcile scan.
-- The shared integration_jobs / external_entity_links / integration_webhook_events
-- tables need NO other change: their `provider` column is unconstrained TEXT and
-- integration_claim_jobs / integration_mark_job_* already accept p_provider.
-- Safe to run repeatedly.

-- 1. Global per-provider worker lock -----------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_worker_locks (
  provider TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ,
  locked_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_worker_locks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_worker_locks' AND policyname = 'integration_worker_locks_service'
  ) THEN
    CREATE POLICY integration_worker_locks_service ON public.integration_worker_locks
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;

-- Try to acquire the lock. Returns TRUE if acquired (free or expired), FALSE if held.
CREATE OR REPLACE FUNCTION public.integration_try_acquire_worker_lock(
  p_provider TEXT,
  p_worker TEXT,
  p_ttl_seconds INT DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  won BOOLEAN;
BEGIN
  INSERT INTO public.integration_worker_locks (provider, locked_until, locked_by, updated_at)
  VALUES (p_provider, now() + make_interval(secs => GREATEST(30, p_ttl_seconds)), p_worker, now())
  ON CONFLICT (provider) DO UPDATE
    SET locked_until = EXCLUDED.locked_until,
        locked_by = EXCLUDED.locked_by,
        updated_at = now()
    WHERE public.integration_worker_locks.locked_until IS NULL
       OR public.integration_worker_locks.locked_until < now()
  RETURNING TRUE INTO won;

  RETURN COALESCE(won, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.integration_release_worker_lock(
  p_provider TEXT,
  p_worker TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.integration_worker_locks
     SET locked_until = NULL, locked_by = NULL, updated_at = now()
   WHERE provider = p_provider AND locked_by = p_worker;
$$;

-- 2. Widen external_entity_links.sync_status enum ----------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'external_entity_links_sync_status_check'
  ) THEN
    ALTER TABLE public.external_entity_links
      DROP CONSTRAINT external_entity_links_sync_status_check;
  END IF;

  ALTER TABLE public.external_entity_links
    ADD CONSTRAINT external_entity_links_sync_status_check
    CHECK (sync_status = ANY (ARRAY['pending', 'synced', 'sent', 'paid', 'error', 'deleted']));
END$$;

-- 3. Payments reconcile scan index -------------------------------------------
CREATE INDEX IF NOT EXISTS external_entity_links_fiken_invoice_idx
  ON public.external_entity_links (company_id, provider, entity_type, sync_status)
  WHERE provider = 'fiken';
