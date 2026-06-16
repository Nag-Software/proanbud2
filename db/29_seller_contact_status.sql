-- Seller CRM fields on companies

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS seller_contact_status TEXT NOT NULL DEFAULT 'ukontaktet'
    CHECK (seller_contact_status IN ('ukontaktet', 'kontaktet', 'oppfolging', 'demo', 'kunde', 'avslaatt'));

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS seller_last_contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_seller_contact_status_idx
  ON public.companies (seller_contact_status);

CREATE INDEX IF NOT EXISTS companies_created_at_idx
  ON public.companies (created_at DESC);
