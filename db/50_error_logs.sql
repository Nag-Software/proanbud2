-- ============================================================================
-- 50_error_logs.sql
-- ----------------------------------------------------------------------------
-- Central error/notification log. Every error a user hits (client render error,
-- failed API call, server action, background worker) is recorded here so the
-- platform admin can see them in /sjefen/feil.
--
-- Writes happen ONLY via the service-role admin client (lib/errors/log.ts and
-- /api/errors). Reads happen via the admin client in the /sjefen query. RLS is
-- therefore enabled with NO authenticated/anon policies (deny-all; service role
-- bypasses RLS) so no tenant can read or tamper with the log.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('warning', 'error', 'fatal')),
  source TEXT NOT NULL DEFAULT 'server' CHECK (source IN ('client', 'server', 'api', 'action', 'worker')),
  message TEXT NOT NULL,
  stack TEXT,
  digest TEXT,
  route TEXT,
  method TEXT,
  status_code INT,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_agent TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Stable signature (source|level|route|normalized message) used to group recurring
  -- occurrences of the same error in the dashboard.
  fingerprint TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS error_logs_created_idx ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_unresolved_idx ON public.error_logs (resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON public.error_logs (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_company_idx ON public.error_logs (company_id);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies for authenticated/anon on purpose: all access is via the
-- service-role admin client. RLS-enabled-with-no-policy = deny-all for everyone else.
