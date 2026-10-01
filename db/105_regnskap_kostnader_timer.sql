-- 105_regnskap_kostnader_timer.sql
-- Faktiske prosjektkostnader fra regnskapet inn, og godkjente timer ut.
--
-- Bakgrunn: dekningsgraden i Proanbud og i regnskapet viste to forskjellige tall.
-- Proanbud kjente bare timene og det som var tastet inn som materialkost; regnskapet
-- kjente innkjøpene, men ikke timene. Nå går timene ut og kostnadene inn.
--
--   * project_accounting_costs       — én rad per kostnadspostering/innkjøpslinje på
--                                      et prosjekt, hentet fra Tripletex eller Fiken.
--   * project_accounting_cost_syncs  — når prosjektet sist ble hentet. Skiller
--                                      «hentet, ingen kostnader» fra «aldri hentet».
--   * accounting_timesheet_links     — hvilken timeføring i regnskapet som speiler
--                                      én ansatts timer på ett prosjekt én dag.
--
-- Regelen for dobbelttelling bor i koden (lib/job-costing/project-profitability.ts):
-- har prosjektet kostnader fra regnskapet, telles ikke manuelle materialposter.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.project_accounting_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fiken', 'tripletex')),
  -- Tripletex: posterings-id. Fiken: «kjøps-id:linje-id».
  external_id TEXT NOT NULL,
  cost_date DATE,
  account_number TEXT,
  account_name TEXT,
  supplier_name TEXT,
  description TEXT,
  -- Bilagsnummer/fakturanummer slik regnskapet viser det, for å kunne slå det opp.
  voucher_ref TEXT,
  -- Eks. mva. Negativt beløp = kreditnota/tilbakeføring.
  amount_nok NUMERIC(14, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS project_accounting_costs_project_idx
  ON public.project_accounting_costs (project_id, cost_date DESC);
CREATE INDEX IF NOT EXISTS project_accounting_costs_company_idx
  ON public.project_accounting_costs (company_id, provider);

CREATE TABLE IF NOT EXISTS public.project_accounting_cost_syncs (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fiken', 'tripletex')),
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cost_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, provider)
);

CREATE INDEX IF NOT EXISTS project_accounting_cost_syncs_company_idx
  ON public.project_accounting_cost_syncs (company_id);

CREATE TABLE IF NOT EXISTS public.accounting_timesheet_links (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fiken', 'tripletex')),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  external_id BIGINT NOT NULL,
  activity_external_id BIGINT,
  -- Timene slik de sist ble sendt. Lik sum = ingen ny forespørsel.
  pushed_hours NUMERIC(6, 2) NOT NULL,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, provider, user_id, project_id, entry_date)
);

CREATE INDEX IF NOT EXISTS accounting_timesheet_links_date_idx
  ON public.accounting_timesheet_links (company_id, provider, entry_date);

ALTER TABLE public.project_accounting_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_accounting_cost_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_timesheet_links ENABLE ROW LEVEL SECURITY;

-- Kostnadene LESES av bedriftens medlemmer (Lønnsomhet-fanen). Bare workeren
-- (service role, forbi RLS) skriver — regnskapet er kilden, ikke brukeren.
DROP POLICY IF EXISTS company_members_select_project_accounting_costs ON public.project_accounting_costs;
CREATE POLICY company_members_select_project_accounting_costs ON public.project_accounting_costs
  FOR SELECT
  USING (company_id = (SELECT public.get_current_company_id()));

DROP POLICY IF EXISTS company_members_select_project_accounting_cost_syncs ON public.project_accounting_cost_syncs;
CREATE POLICY company_members_select_project_accounting_cost_syncs ON public.project_accounting_cost_syncs
  FOR SELECT
  USING (company_id = (SELECT public.get_current_company_id()));

-- accounting_timesheet_links er ren synk-bokføring: ingen policy = kun service role.

DROP POLICY IF EXISTS active_authenticated_user ON public.project_accounting_costs;
CREATE POLICY active_authenticated_user ON public.project_accounting_costs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

DROP POLICY IF EXISTS active_authenticated_user ON public.project_accounting_cost_syncs;
CREATE POLICY active_authenticated_user ON public.project_accounting_cost_syncs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

DROP POLICY IF EXISTS active_authenticated_user ON public.accounting_timesheet_links;
CREATE POLICY active_authenticated_user ON public.accounting_timesheet_links
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

COMMENT ON TABLE public.project_accounting_costs IS
  'Kostnader ført på prosjektet i regnskapet (Tripletex/Fiken). Skrives kun av synk-workeren.';
COMMENT ON TABLE public.project_accounting_cost_syncs IS
  'Sist hentet per prosjekt og leverandør, så UI kan skille «ingen kostnader» fra «aldri hentet».';
COMMENT ON TABLE public.accounting_timesheet_links IS
  'Timeføring i regnskapet per ansatt/prosjekt/dag, med timene slik de sist ble sendt.';
