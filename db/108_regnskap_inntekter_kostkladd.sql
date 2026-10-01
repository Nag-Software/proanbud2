-- 108_regnskap_inntekter_kostkladd.sql
-- Toveis synk av prosjektøkonomi mot regnskapet (Fiken/Tripletex):
--
--   * project_accounting_revenues — inntekt bokført på prosjektet i regnskapet
--     (konto 3000–3999), også fakturaer som er laget direkte der. Vises som
--     «Fakturert» på Økonomi. Dekningsgraden regnes fortsatt på avtalt omsetning
--     (tilbud + tillegg) — fakturert er et ledd i pengeflyten, ikke fasit for DG.
--     Skrives kun av synk-workeren (samme jobb som henter kostnadene).
--
--   * material_cost.push — materialkostnader ført i ProAnbud sendes til regnskapet
--     som kladd (Fiken kjøpskladd / Tripletex ikke-bokført bilag). Jobben OPPRETTER
--     noe i kundens regnskap, så stuck-job-reaperen må aldri kjøre den om igjen
--     automatisk: en dublett er en ekstra kladd regnskapsføreren må rydde.
--
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.project_accounting_revenues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('fiken', 'tripletex')),
  -- Tripletex: posterings-id. Fiken: «salgs-id:linje-id».
  external_id TEXT NOT NULL,
  entry_date DATE,
  account_number TEXT,
  account_name TEXT,
  customer_name TEXT,
  description TEXT,
  -- Fakturanummer / bilagsnummer slik regnskapet viser det.
  voucher_ref TEXT,
  -- Eks. mva. Negativt = kreditnota.
  amount_nok NUMERIC(14, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_accounting_revenues_source_external_key UNIQUE (company_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_project_accounting_revenues_project
  ON public.project_accounting_revenues (project_id, entry_date DESC);

ALTER TABLE public.project_accounting_revenues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_project_accounting_revenues ON public.project_accounting_revenues;
CREATE POLICY company_members_select_project_accounting_revenues ON public.project_accounting_revenues
  FOR SELECT
  USING (company_id = (SELECT public.get_current_company_id()));

DROP POLICY IF EXISTS active_authenticated_user ON public.project_accounting_revenues;
CREATE POLICY active_authenticated_user ON public.project_accounting_revenues
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

COMMENT ON TABLE public.project_accounting_revenues IS
  'Inntekt bokført på prosjektet i regnskapet (Fiken/Tripletex, konto 3000–3999). Skrives kun av synk-workeren.';

-- Reaperen: samme funksjon som db/88, med material_cost.push på «utrygg»-listen.
CREATE OR REPLACE FUNCTION public.integration_reap_stuck_jobs(
  p_provider TEXT DEFAULT 'tripletex',
  p_stale_seconds INT DEFAULT 900
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - make_interval(secs => GREATEST(60, p_stale_seconds));
  v_failed INT := 0;
  v_label TEXT := CASE p_provider WHEN 'fiken' THEN 'Fiken' WHEN 'tripletex' THEN 'Tripletex' ELSE p_provider END;
  v_message TEXT;
  -- Oppretter noe ekte som ikke kan søkes tilbake ⇒ må ALDRI kjøres om igjen selv.
  v_unsafe TEXT[] := ARRAY[
    -- ordre og faktura (begge leverandører)
    'order.create_from_offer',
    'invoice.create_from_offer',
    'invoice.create_from_project_invoice',
    -- sender en ekte e-post til kunden
    'invoice.send',
    -- Fikens tilbud får et dokumentnummer og har ingen draft-uuid-gjenoppretting
    'offer.create_from_offer',
    -- kunde: samme handling, to navn
    'customer.upsert',
    'contact.upsert',
    -- prosjekt
    'project.upsert',
    -- reiseregning: en dublett betyr kjøregodtgjørelse utbetalt to ganger
    'travel_expense.upsert',
    -- materialkost som kladd/bilag i kundens regnskap
    'material_cost.push'
  ];
  -- Bevisst UTENFOR listen (trygge å kjøre om igjen):
  --   reconcile.full, poll_payments, customer.pull_all, employee.sync_all,
  --   document.upload, calendar.activity.upsert, travel_expense.delete,
  --   webhook.invoice_paid, costs.pull, material_cost.delete (sletter bare
  --   kladden vi selv laget; 404 = allerede borte), og Tripletex' offer.upsert.
BEGIN
  v_message := 'Worker stoppet mens jobben kjørte – kan ha rukket å opprette i '
               || v_label || '. Sjekk i ' || v_label || ' før du prøver på nytt.';

  WITH reaped_failed AS (
    UPDATE public.integration_jobs
       SET status = 'failed',
           locked_by = NULL,
           locked_at = NULL,
           last_error_code = 'reaped_stuck',
           last_error_message = v_message,
           updated_at = now()
     WHERE provider = p_provider
       AND status = 'processing'
       AND locked_at IS NOT NULL
       AND locked_at < v_cutoff
       AND job_type = ANY (v_unsafe)
    RETURNING 1
  )
  SELECT count(*) INTO v_failed FROM reaped_failed;

  UPDATE public.integration_jobs
     SET status = 'retry',
         locked_by = NULL,
         locked_at = NULL,
         next_run_at = now(),
         updated_at = now()
   WHERE provider = p_provider
     AND status = 'processing'
     AND locked_at IS NOT NULL
     AND locked_at < v_cutoff
     AND NOT (job_type = ANY (v_unsafe));

  RETURN v_failed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integration_reap_stuck_jobs(text, integer) FROM PUBLIC, anon, authenticated;
