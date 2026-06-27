-- Default hourly rates per job type per company
-- (e.g. "Tømrerarbeid: 650 kr/t", "Byggingeniør: 900 kr/t").

CREATE TABLE IF NOT EXISTS public.hourly_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  hourly_rate_nok NUMERIC(12, 2) NOT NULL CHECK (hourly_rate_nok >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hourly_rates_company_id ON public.hourly_rates(company_id);
CREATE INDEX IF NOT EXISTS idx_hourly_rates_company_sort ON public.hourly_rates(company_id, sort_order, job_type);

ALTER TABLE public.hourly_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_hourly_rates ON public.hourly_rates;
CREATE POLICY company_members_select_hourly_rates
  ON public.hourly_rates FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_insert_hourly_rates ON public.hourly_rates;
CREATE POLICY company_members_insert_hourly_rates
  ON public.hourly_rates FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_update_hourly_rates ON public.hourly_rates;
CREATE POLICY company_members_update_hourly_rates
  ON public.hourly_rates FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_delete_hourly_rates ON public.hourly_rates;
CREATE POLICY company_members_delete_hourly_rates
  ON public.hourly_rates FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
