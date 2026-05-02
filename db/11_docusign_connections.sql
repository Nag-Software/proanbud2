-- 11_docusign_connections.sql

CREATE TABLE IF NOT EXISTS public.docusign_connections (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE PRIMARY KEY,
  account_id TEXT,
  base_uri TEXT,
  sync_state TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.docusign_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'docusign_connections' AND policyname = 'docusign_connections_select'
  ) THEN
    CREATE POLICY docusign_connections_select ON public.docusign_connections
      FOR SELECT USING (company_id IN (
        SELECT company_id FROM public.users WHERE id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'docusign_connections' AND policyname = 'docusign_connections_manage'
  ) THEN
    CREATE POLICY docusign_connections_manage ON public.docusign_connections
      FOR ALL USING (company_id IN (
        SELECT company_id FROM public.users WHERE id = auth.uid()
      ));
  END IF;
END $$;
