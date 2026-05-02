-- 08_tripletex_integration.sql
-- Hardening + RLS + helper RPCs for Tripletex integration tables.
-- Safe to run even if base tables already exist.

ALTER TABLE IF EXISTS public.tripletex_connections
  ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS scope_config JSONB NOT NULL DEFAULT '{"customers":true,"projects":true,"offers":true,"invoices":true,"documents":false}'::jsonb;

CREATE INDEX IF NOT EXISTS external_entity_links_lookup_local_idx
  ON public.external_entity_links (company_id, provider, entity_type, local_id);

CREATE INDEX IF NOT EXISTS external_entity_links_lookup_external_idx
  ON public.external_entity_links (company_id, provider, entity_type, external_id);

CREATE INDEX IF NOT EXISTS integration_jobs_company_status_idx
  ON public.integration_jobs (company_id, status, next_run_at);

CREATE INDEX IF NOT EXISTS integration_jobs_provider_job_type_idx
  ON public.integration_jobs (provider, job_type, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_webhook_events_pending_idx
  ON public.integration_webhook_events (provider, process_status, received_at)
  WHERE process_status = 'pending';

CREATE INDEX IF NOT EXISTS integration_webhook_events_company_idx
  ON public.integration_webhook_events (company_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_tripletex_connections') THEN
    CREATE TRIGGER set_updated_at_tripletex_connections
    BEFORE UPDATE ON public.tripletex_connections
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_external_entity_links') THEN
    CREATE TRIGGER set_updated_at_external_entity_links
    BEFORE UPDATE ON public.external_entity_links
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_integration_jobs') THEN
    CREATE TRIGGER set_updated_at_integration_jobs
    BEFORE UPDATE ON public.integration_jobs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

ALTER TABLE IF EXISTS public.tripletex_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.external_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.integration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.integration_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tripletex_connections' AND policyname = 'tripletex_connections_select'
  ) THEN
    CREATE POLICY tripletex_connections_select ON public.tripletex_connections
      FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tripletex_connections' AND policyname = 'tripletex_connections_manage'
  ) THEN
    CREATE POLICY tripletex_connections_manage ON public.tripletex_connections
      FOR ALL
      USING (
        company_id = public.get_current_company_id()
        AND (public.is_company_admin() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager')
      )
      WITH CHECK (
        company_id = public.get_current_company_id()
        AND (public.is_company_admin() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'external_entity_links' AND policyname = 'external_links_select'
  ) THEN
    CREATE POLICY external_links_select ON public.external_entity_links
      FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'external_entity_links' AND policyname = 'external_links_service_write'
  ) THEN
    CREATE POLICY external_links_service_write ON public.external_entity_links
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_jobs' AND policyname = 'integration_jobs_select'
  ) THEN
    CREATE POLICY integration_jobs_select ON public.integration_jobs
      FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_jobs' AND policyname = 'integration_jobs_insert'
  ) THEN
    CREATE POLICY integration_jobs_insert ON public.integration_jobs
      FOR INSERT
      WITH CHECK (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_jobs' AND policyname = 'integration_jobs_service_write'
  ) THEN
    CREATE POLICY integration_jobs_service_write ON public.integration_jobs
      FOR UPDATE
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_webhook_events' AND policyname = 'integration_webhook_events_select'
  ) THEN
    CREATE POLICY integration_webhook_events_select ON public.integration_webhook_events
      FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_webhook_events' AND policyname = 'integration_webhook_events_service_write'
  ) THEN
    CREATE POLICY integration_webhook_events_service_write ON public.integration_webhook_events
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.integration_claim_jobs(
  p_worker TEXT,
  p_provider TEXT DEFAULT 'tripletex',
  p_limit INT DEFAULT 20
)
RETURNS SETOF public.integration_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.integration_jobs j
    WHERE j.provider = p_provider
      AND j.status IN ('pending', 'retry')
      AND j.next_run_at <= now()
      AND (j.rate_limit_reset_at IS NULL OR j.rate_limit_reset_at <= now())
    ORDER BY j.next_run_at ASC, j.id ASC
    LIMIT GREATEST(1, p_limit)
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.integration_jobs j
      SET status = 'processing',
          locked_by = p_worker,
          locked_at = now(),
          updated_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.integration_mark_job_completed(p_job_id BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.integration_jobs
     SET status = 'completed',
         locked_by = NULL,
         locked_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = now()
   WHERE id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.integration_mark_job_retry(
  p_job_id BIGINT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_next_run_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.integration_jobs
     SET status = 'retry',
         attempt_count = attempt_count + 1,
         next_run_at = p_next_run_at,
         locked_by = NULL,
         locked_at = NULL,
         last_error_code = p_error_code,
         last_error_message = left(coalesce(p_error_message, ''), 1000),
         updated_at = now()
   WHERE id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.integration_mark_job_failed(
  p_job_id BIGINT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_dead_letter BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.integration_jobs
     SET status = CASE WHEN p_dead_letter THEN 'dead_letter' ELSE 'failed' END,
         attempt_count = attempt_count + 1,
         locked_by = NULL,
         locked_at = NULL,
         last_error_code = p_error_code,
         last_error_message = left(coalesce(p_error_message, ''), 1000),
         updated_at = now()
   WHERE id = p_job_id;
$$;
