-- 23_contracts.sql
-- First-class contracts linked to offers, with separate signing and ERP tracks.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS signing_provider TEXT
    CHECK (signing_provider IN ('docusign', 'manual', 'none')),
  ADD COLUMN IF NOT EXISTS tripletex_order_trigger TEXT
    CHECK (tripletex_order_trigger IN ('on_contract_send', 'on_contract_signed', 'manual'))
    DEFAULT 'on_contract_signed';

UPDATE public.companies
SET signing_provider = CASE
  WHEN contract_provider = 'docusign' THEN 'docusign'
  WHEN contract_provider = 'tripletex' THEN 'none'
  ELSE COALESCE(signing_provider, 'docusign')
END
WHERE signing_provider IS NULL;

UPDATE public.companies
SET tripletex_order_trigger = COALESCE(tripletex_order_trigger, 'on_contract_signed')
WHERE tripletex_order_trigger IS NULL;

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS pricing_model TEXT
    CHECK (pricing_model IN ('fixed', 'time_materials', 'unit_price', 'mixed'))
    DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS contract_basis TEXT
    CHECK (contract_basis IN ('ns8405', 'ns8407', 'custom', 'none'))
    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS markup_percent NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_schedule JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contract_id UUID;

CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL UNIQUE REFERENCES public.offers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'delivered', 'completed', 'declined', 'voided', 'error')),
  pricing_model TEXT NOT NULL DEFAULT 'fixed'
    CHECK (pricing_model IN ('fixed', 'time_materials', 'unit_price', 'mixed')),
  contract_basis TEXT DEFAULT 'none'
    CHECK (contract_basis IN ('ns8405', 'ns8407', 'custom', 'none')),
  title TEXT NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount_nok NUMERIC(14,2),
  payment_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  signing_provider TEXT NOT NULL DEFAULT 'docusign'
    CHECK (signing_provider IN ('docusign', 'manual', 'none')),
  signing_external_id TEXT,
  signing_external_url TEXT,
  erp_provider TEXT NOT NULL DEFAULT 'none'
    CHECK (erp_provider IN ('tripletex', 'none')),
  erp_external_id TEXT,
  erp_external_url TEXT,
  erp_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (erp_status IN ('pending', 'synced', 'error')),
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_company_id ON public.contracts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_project_id ON public.contracts(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts(company_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'offers_contract_id_fkey'
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT offers_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS view_contracts ON public.contracts;
DROP POLICY IF EXISTS manage_contracts ON public.contracts;

CREATE POLICY view_contracts
ON public.contracts
FOR SELECT
USING (
  company_id = public.get_current_company_id()
  AND (
    project_id IS NULL
    OR public.has_project_access(project_id)
  )
);

CREATE POLICY manage_contracts
ON public.contracts
FOR ALL
USING (company_id = public.get_current_company_id())
WITH CHECK (company_id = public.get_current_company_id());

-- Migrate legacy analysis_result.contract into contracts table
INSERT INTO public.contracts (
  company_id,
  offer_id,
  project_id,
  customer_id,
  status,
  pricing_model,
  title,
  line_items,
  amount_nok,
  signing_provider,
  signing_external_id,
  signing_external_url,
  erp_provider,
  erp_external_id,
  erp_external_url,
  erp_status,
  sent_at,
  signed_at,
  last_error,
  created_at,
  updated_at
)
SELECT
  o.company_id,
  o.id,
  o.project_id,
  o.customer_id,
  CASE
    WHEN (o.analysis_result->'contract'->>'status') IN ('sent', 'delivered', 'completed', 'declined', 'voided', 'error')
      THEN o.analysis_result->'contract'->>'status'
    ELSE 'draft'
  END,
  COALESCE(o.pricing_model, 'fixed'),
  COALESCE('Kontrakt — ' || o.title, 'Kontrakt'),
  COALESCE(o.line_items, '[]'::jsonb),
  o.amount_nok,
  CASE
    WHEN o.analysis_result->'contract'->>'provider' = 'tripletex' THEN 'none'
    ELSE 'docusign'
  END,
  o.analysis_result->'contract'->>'envelopeId',
  o.analysis_result->'contract'->>'externalUrl',
  CASE
    WHEN o.analysis_result->'contract'->>'provider' = 'tripletex' THEN 'tripletex'
    ELSE 'none'
  END,
  CASE
    WHEN o.analysis_result->'contract'->>'provider' = 'tripletex'
      THEN o.analysis_result->'contract'->>'envelopeId'
    ELSE NULL
  END,
  CASE
    WHEN o.analysis_result->'contract'->>'provider' = 'tripletex'
      THEN o.analysis_result->'contract'->>'externalUrl'
    ELSE NULL
  END,
  CASE
    WHEN o.analysis_result->'contract'->>'provider' = 'tripletex'
      AND o.analysis_result->'contract'->>'envelopeId' IS NOT NULL THEN 'synced'
    ELSE 'pending'
  END,
  (o.analysis_result->'contract'->>'sentAt')::timestamptz,
  (o.analysis_result->'contract'->>'signedAt')::timestamptz,
  o.analysis_result->'contract'->>'lastError',
  COALESCE(o.updated_at, now()),
  COALESCE(o.updated_at, now())
FROM public.offers o
WHERE o.analysis_result ? 'contract'
  AND o.analysis_result->'contract' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contracts c WHERE c.offer_id = o.id
  );

UPDATE public.offers o
SET contract_id = c.id
FROM public.contracts c
WHERE c.offer_id = o.id
  AND o.contract_id IS NULL;
