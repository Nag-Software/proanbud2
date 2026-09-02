-- 88_reaper_begge_leverandorer.sql
--
-- Gjør stuck-job-reaperen riktig for BEGGE regnskapsintegrasjonene.
--
-- Bakgrunn: db/44 innførte `integration_reap_stuck_jobs`, men «utrygg»-listen ble
-- skrevet med Tripletex' kø-navn alene. Fiken bruker andre navn for det samme, og
-- har i tillegg jobbtyper Tripletex ikke hadde da. Konsekvensen var alvorlig:
--
--   * `invoice.create_from_project_invoice` (pengeveien i dag) sto IKKE på listen,
--     så en jobb som døde etter at Fiken hadde opprettet fakturaen ville blitt
--     kjørt om igjen automatisk — og laget faktura nummer to på samme arbeid.
--   * `contact.upsert` er Fikens navn på `customer.upsert`. Bare det siste sto der.
--   * `invoice.send` sender en ekte e-post til kunden.
--
-- Regelen er uendret: en jobb som OPPRETTER noe vi ikke kan søke oss tilbake til,
-- må feile synlig etter en worker-død — aldri retryes. Vi vet ikke om POST-en rakk
-- fram, og verken Fiken eller Tripletex har idempotency-nøkler.
--
-- Feilmeldingen navngir nå leverandøren, i stedet for alltid å si «Tripletex».
--
-- Trygg å kjøre flere ganger.

CREATE OR REPLACE FUNCTION public.integration_reap_stuck_jobs(
  p_provider TEXT DEFAULT 'tripletex',
  p_stale_seconds INT DEFAULT 900
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
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
    -- sender en ekte e-post til kunden; guarden i koden hjelper ikke hvis
    -- workeren døde mellom utsending og statusskriving
    'invoice.send',
    -- Fikens tilbud får et dokumentnummer og har ingen draft-uuid-gjenoppretting
    -- (til forskjell fra faktura, som kan finnes igjen via invoiceDraftUuid)
    'offer.create_from_offer',
    -- kunde: samme handling, to navn
    'customer.upsert',
    'contact.upsert',
    -- prosjekt
    'project.upsert',
    -- reiseregning: en dublett betyr kjøregodtgjørelse utbetalt to ganger
    'travel_expense.upsert'
  ];
  -- Bevisst UTENFOR listen (trygge å kjøre om igjen):
  --   reconcile.full, poll_payments, customer.pull_all, employee.sync_all,
  --   document.upload, calendar.activity.upsert, travel_expense.delete,
  --   webhook.invoice_paid, og Tripletex' offer.upsert (som slår opp
  --   eksisterende tilbud på ProAnbud-id før den oppretter).
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
