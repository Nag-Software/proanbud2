-- Etterkalkyle / jobblønnsomhet (Fase 1).
-- Omsetning (offers.line_items/amount_nok) og timer (time_entries) finnes allerede.
-- Dette dekker det som manglet: faktisk materialkost per prosjekt + kostpris per time
-- (skilt fra salgsprisen hourly_rate_nok som brukes i tilbud).

ALTER TABLE IF EXISTS public.hourly_rates
  ADD COLUMN IF NOT EXISTS cost_rate_nok NUMERIC(12, 2)
  CHECK (cost_rate_nok IS NULL OR cost_rate_nok >= 0);

CREATE TABLE IF NOT EXISTS public.project_material_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_name TEXT,
  description TEXT,
  amount_nok NUMERIC(12, 2) NOT NULL CHECK (amount_nok >= 0),
  invoice_ref TEXT,
  cost_date DATE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_material_costs_company ON public.project_material_costs(company_id);
CREATE INDEX IF NOT EXISTS idx_project_material_costs_project ON public.project_material_costs(project_id);

ALTER TABLE public.project_material_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_project_material_costs ON public.project_material_costs;
CREATE POLICY company_members_select_project_material_costs
  ON public.project_material_costs FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_insert_project_material_costs ON public.project_material_costs;
CREATE POLICY company_members_insert_project_material_costs
  ON public.project_material_costs FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_update_project_material_costs ON public.project_material_costs;
CREATE POLICY company_members_update_project_material_costs
  ON public.project_material_costs FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_delete_project_material_costs ON public.project_material_costs;
CREATE POLICY company_members_delete_project_material_costs
  ON public.project_material_costs FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
