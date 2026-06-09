-- Saved jobs with fixed prices per company (e.g. "Vindusbytte: 5000 kr").

CREATE TABLE IF NOT EXISTS public.saved_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_nok NUMERIC(12, 2) NOT NULL CHECK (price_nok >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_jobs_company_id ON public.saved_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_company_sort ON public.saved_jobs(company_id, sort_order, name);

ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_saved_jobs ON public.saved_jobs;
CREATE POLICY company_members_select_saved_jobs
  ON public.saved_jobs FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_insert_saved_jobs ON public.saved_jobs;
CREATE POLICY company_members_insert_saved_jobs
  ON public.saved_jobs FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_update_saved_jobs ON public.saved_jobs;
CREATE POLICY company_members_update_saved_jobs
  ON public.saved_jobs FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_delete_saved_jobs ON public.saved_jobs;
CREATE POLICY company_members_delete_saved_jobs
  ON public.saved_jobs FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
