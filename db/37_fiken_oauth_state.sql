-- 37_fiken_oauth_state.sql
-- Short-lived CSRF/state store for the Fiken OAuth2 authorization_code redirect.
-- The callback arrives without a session-bound company context, so we map the
-- random `state` (and optional PKCE code_verifier) back to the originating company.
-- Cleaned up on use; rows expire after a few minutes.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.fiken_oauth_state (
  state TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  code_verifier TEXT,            -- PKCE (only used if Fiken requires it)
  redirect_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS fiken_oauth_state_expiry_idx
  ON public.fiken_oauth_state (expires_at);

ALTER TABLE public.fiken_oauth_state ENABLE ROW LEVEL SECURITY;

-- service_role only: the start/callback routes run server-side with the admin client.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fiken_oauth_state' AND policyname = 'fiken_oauth_state_service'
  ) THEN
    CREATE POLICY fiken_oauth_state_service ON public.fiken_oauth_state
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;
