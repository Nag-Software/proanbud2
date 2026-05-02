-- 07_nytt_tilbud_workflow.sql
-- Utvider offers-tabellen for /nytt-tilbud-flyt:
-- - Prosjekt eller kun kunde
-- - Analysegrunnlag / dokumentmetadata
-- - Redigerbare linjeelementer med delprosjekt
-- - Forhåndsvisning, utkast, og sending

ALTER TABLE public.offers
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS source_summary TEXT,
  ADD COLUMN IF NOT EXISTS source_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS analysis_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS subtotal_nok NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_nok NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS send_to_customer_direct BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
  ADD COLUMN IF NOT EXISTS quote_valid_until DATE,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offers_project_or_customer_chk'
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT offers_project_or_customer_chk
      CHECK (project_id IS NOT NULL OR customer_id IS NOT NULL)
      NOT VALID;
  END IF;
END$$;

ALTER TABLE public.offers VALIDATE CONSTRAINT offers_project_or_customer_chk;

CREATE INDEX IF NOT EXISTS idx_offers_customer_id ON public.offers(customer_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON public.offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_sent_at ON public.offers(sent_at DESC NULLS LAST);

DROP POLICY IF EXISTS view_offers_for_accessible_projects ON public.offers;
DROP POLICY IF EXISTS manage_offers ON public.offers;

CREATE POLICY view_offers_for_accessible_projects
ON public.offers
FOR SELECT
USING (
  company_id = public.get_current_company_id()
  AND (
    project_id IS NULL
    OR public.has_project_access(project_id)
  )
);

CREATE POLICY manage_offers
ON public.offers
FOR ALL
USING (
  company_id = public.get_current_company_id()
  AND (
    public.is_company_admin()
    OR (
      project_id IS NULL
      AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = offers.project_id
        AND pm.user_id = auth.uid()
        AND pm.access_level IN ('write', 'manager')
    )
  )
)
WITH CHECK (
  company_id = public.get_current_company_id()
  AND (
    public.is_company_admin()
    OR (
      project_id IS NULL
      AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = offers.project_id
        AND pm.user_id = auth.uid()
        AND pm.access_level IN ('write', 'manager')
    )
  )
);
