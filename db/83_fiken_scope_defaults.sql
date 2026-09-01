-- 83_fiken_scope_defaults.sql
-- Arbeidsdelingen mellom ProAnbud og Fiken, uttrykt i standardvalgene.
--
--   ProAnbud  = tilbud, kundekontakt og prosjektstyring
--   Fiken     = faktura og betalingsmottak
--
-- Konsekvenser for scope_config:
--   * offers  -> FALSE. ProAnbud eier tilbudet og den digitale aksepten. En kopi i
--                Fiken er kun regnskapspynt, og Fikens tilbud har ingen aksept-flyt.
--   * projects-> FALSE. Fikens prosjektmodul koster 69 kr/mnd; de fleste har den ikke,
--                og API-et svarer 402. Manglende prosjekt stopper ikke fakturering.
--   * sendInvoiceFromFiken -> TRUE. Fiken er betalingsmottaker og eier fakturanummer,
--                KID og EHF, så det er Fiken som sender fakturaen — utløst fra ProAnbud.
--
-- Safe to run repeatedly.

ALTER TABLE public.fiken_connections
  ALTER COLUMN scope_config SET DEFAULT
    '{"contacts":true,"projects":false,"offers":false,"invoices":true,"products":false,"inbox":false,"sendInvoiceFromFiken":true}'::jsonb;

-- Eksisterende tilkoblinger: sett det nye feltet eksplisitt, og rett tilbud/prosjekt
-- til arbeidsdelingen over. Bedrifter som vil ha regnskapskopi av tilbud eller har
-- kjøpt prosjektmodulen slår dem på igjen i UI-et.
UPDATE public.fiken_connections
SET scope_config = scope_config
      || '{"offers":false,"projects":false}'::jsonb
      || jsonb_build_object(
           'sendInvoiceFromFiken',
           COALESCE(scope_config->'sendInvoiceFromFiken', 'true'::jsonb)
         )
WHERE scope_config IS NOT NULL;

COMMENT ON COLUMN public.fiken_connections.scope_config IS
  'Hva som synkroniseres til Fiken. ProAnbud eier tilbud/kundekontakt; Fiken eier faktura og betaling.';
