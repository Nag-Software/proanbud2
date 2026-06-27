-- Outbound lead engine ("kundemaskin"): prospects imported from Brønnøysund,
-- their outreach drafts/sends, and an opt-out list.
-- Internal/platform-only data — accessed via the service-role admin client behind
-- requirePlatformSellerForApi. RLS is enabled with no policies, so it is invisible
-- to normal authenticated/anon clients.

-- ============================================================
-- Prospects (external companies not yet signed up)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  nace_code TEXT,
  nace_description TEXT,
  employee_count INTEGER,
  website TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  kommune TEXT,
  kommune_number TEXT,
  source TEXT NOT NULL DEFAULT 'brreg',
  enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'no_contact')),
  status TEXT NOT NULL DEFAULT 'ny'
    CHECK (status IN ('ny', 'kvalifisert', 'kontaktet', 'svar', 'demo', 'kunde', 'avvist')),
  matched_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  is_existing_customer BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospects_status_idx ON public.prospects (status);
CREATE INDEX IF NOT EXISTS prospects_nace_idx ON public.prospects (nace_code);
CREATE INDEX IF NOT EXISTS prospects_kommune_idx ON public.prospects (kommune_number);
CREATE INDEX IF NOT EXISTS prospects_enrichment_idx ON public.prospects (enrichment_status);
CREATE INDEX IF NOT EXISTS prospects_has_email_idx ON public.prospects (email) WHERE email IS NOT NULL;

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Per-prospect outreach (AI drafts, approval, send tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prospect_outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  step_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('queued', 'awaiting_approval', 'approved', 'sent', 'replied', 'bounced', 'unsubscribed', 'stopped', 'rejected')),
  ai_subject TEXT,
  ai_body TEXT,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_outreach_prospect_idx ON public.prospect_outreach (prospect_id);
CREATE INDEX IF NOT EXISTS prospect_outreach_status_idx ON public.prospect_outreach (status);

ALTER TABLE public.prospect_outreach ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Opt-out list (checked before every send) — markedsføringsloven/GDPR
-- ============================================================
CREATE TABLE IF NOT EXISTS public.outreach_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  org_number TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_unsubscribes_org_idx ON public.outreach_unsubscribes (org_number);

ALTER TABLE public.outreach_unsubscribes ENABLE ROW LEVEL SECURITY;
