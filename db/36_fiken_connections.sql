-- 36_fiken_connections.sql
-- Fiken accounting integration: per-company connection table.
-- Mirrors tripletex_connections but for OAuth2 (Bearer access+refresh) instead of
-- consumer/employee session tokens. Reuses the provider-agnostic shared tables
-- (integration_jobs, external_entity_links, integration_webhook_events) with provider='fiken'.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.fiken_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- OAuth2 (authorization_code) tokens, AES-256-GCM encrypted (iv.tag.ciphertext)
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  -- optional personal-token mode (own company only; ToS forbids for third parties)
  personal_token_enc TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_mode IN ('oauth', 'personal')),
  -- Fiken company scoping (slug is the path key; there is no numeric company id)
  fiken_company_slug TEXT,
  fiken_company_name TEXT,
  is_test_company BOOLEAN NOT NULL DEFAULT false,
  -- Fiken-specific defaults (no numeric ids)
  default_vat_type TEXT,            -- e.g. 'HIGH'
  default_income_account TEXT,      -- e.g. '3000'
  default_bank_account_code TEXT,   -- for POST /invoices
  -- health / lifecycle (mirrors tripletex_connections)
  sync_state TEXT NOT NULL DEFAULT 'connected'
    CHECK (sync_state IN ('connected', 'degraded', 'disconnected')),
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  -- date-granularity cursor for the payments poller (Fiken lastModified is YYYY-MM-DD)
  last_payment_poll_date DATE,
  scope_config JSONB NOT NULL DEFAULT
    '{"contacts":true,"projects":true,"offers":true,"invoices":true,"products":false,"inbox":false}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS fiken_connections_company_idx
  ON public.fiken_connections (company_id);

ALTER TABLE public.fiken_connections ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (reuses handle_updated_at() from db/08)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_fiken_connections') THEN
    CREATE TRIGGER set_updated_at_fiken_connections
    BEFORE UPDATE ON public.fiken_connections
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

-- RLS: company members can read; admin/manager can manage. Mirrors db/08 Tripletex policies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fiken_connections' AND policyname = 'fiken_connections_select'
  ) THEN
    CREATE POLICY fiken_connections_select ON public.fiken_connections
      FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fiken_connections' AND policyname = 'fiken_connections_manage'
  ) THEN
    CREATE POLICY fiken_connections_manage ON public.fiken_connections
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
