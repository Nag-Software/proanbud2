-- 44_tripletex_idempotency_reaper.sql
-- Money-path hardening for the integration job queue (Tripletex/Fiken):
--   1. Version-control the UNIQUE(idempotency_key) invariant the enqueue dedup relies on
--      (prod already has it via a constraint-backed index; this is a no-op there, but
--      guarantees the invariant in every environment).
--   2. Add a reaper RPC that recovers jobs orphaned in status='processing' by a worker
--      that died mid-run. The claim RPC (integration_claim_jobs) only ever selects
--      'pending'/'retry', so stuck 'processing' rows would otherwise be locked forever.
-- Safe to run repeatedly.

-- 1. Enqueue dedup invariant. enqueueIntegrationJob() swallows 23505 to dedup; that only
--    works if a UNIQUE index on idempotency_key exists. Create one only if none is present
--    (avoids a redundant duplicate of the existing constraint-backed index in prod).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'integration_jobs'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%(idempotency_key)%'
  ) THEN
    CREATE UNIQUE INDEX integration_jobs_idempotency_key_uniq
      ON public.integration_jobs (idempotency_key);
  END IF;
END$$;

-- 2. Stale-lock reaper. Requeues idempotent / search-first-protected steps; fails the
--    non-idempotent creators (orders, invoices, customers, projects) for manual review —
--    after a worker death we can't tell whether their POST/PUT already created the entity,
--    and Tripletex has no idempotency key and can't be searched back by our reference, so
--    auto-retrying would risk a real duplicate (e.g. a second invoice to the customer).
CREATE OR REPLACE FUNCTION public.integration_reap_stuck_jobs(
  p_provider TEXT DEFAULT 'tripletex',
  p_stale_seconds INT DEFAULT 900
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - make_interval(secs => GREATEST(60, p_stale_seconds));
  v_failed INT := 0;
  v_unsafe TEXT[] := ARRAY[
    'order.create_from_offer',
    'invoice.create_from_offer',
    'customer.upsert',
    'project.upsert'
  ];
BEGIN
  WITH reaped_failed AS (
    UPDATE public.integration_jobs
       SET status = 'failed',
           locked_by = NULL,
           locked_at = NULL,
           last_error_code = 'reaped_stuck',
           last_error_message = 'Worker stoppet mens jobben kjørte – kan ha rukket å opprette i Tripletex. Sjekk i Tripletex før du prøver på nytt.',
           updated_at = now()
     WHERE provider = p_provider
       AND status = 'processing'
       AND locked_at IS NOT NULL
       AND locked_at < v_cutoff
       AND job_type = ANY (v_unsafe)
    RETURNING 1
  )
  SELECT count(*) INTO v_failed FROM reaped_failed;

  UPDATE public.integration_jobs
     SET status = 'retry',
         locked_by = NULL,
         locked_at = NULL,
         next_run_at = now(),
         updated_at = now()
   WHERE provider = p_provider
     AND status = 'processing'
     AND locked_at IS NOT NULL
     AND locked_at < v_cutoff
     AND NOT (job_type = ANY (v_unsafe));

  RETURN v_failed;
END;
$$;
