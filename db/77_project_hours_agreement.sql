-- ============================================================================
-- 77_project_hours_agreement.sql
-- ----------------------------------------------------------------------------
-- Timeavtalen med kunden, atskilt fra det interne kostbudsjettet i db/76.
--
--   approved_hours
--       Kundens tak: hvor mange timer kunden har sagt ja til å betale for.
--       NULL betyr «ikke overstyrt manuelt» — da brukes timer fra HOUR_UNITS-
--       linjene i aksepterte tilbud i stedet (se lib/job-costing/calc.ts,
--       resolveApprovedHours). Samme NULL-mønster som budgeted_hours i db/76:
--       å tømme feltet i UI-et betyr «bruk tilbudet igjen», ikke 0 timer.
--
--       Bevisst ATSKILT fra budgeted_hours: budgeted_hours er prosjektlederens
--       eget kost-/effektivitetsmål og kan avvike fra hva kunden faktisk har
--       godkjent å betale for.
--
--   is_hourly_billing / hourly_billing_rate_nok
--       Prosjekter som går på løpende regning uten noe akseptert tilbud i
--       systemet i det hele tatt (rene timejobber). Når på, regnes omsetning
--       også som førte timer × denne timeprisen — i tillegg til ev. aksepterte
--       tilbud/tillegg, ikke i stedet for. Fungerer helt uavhengig av om
--       prosjektet har noe tilbud.
--
-- Idempotent: trygg å kjøre om igjen.
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS approved_hours NUMERIC(10, 2)
    CHECK (approved_hours IS NULL OR approved_hours >= 0),
  ADD COLUMN IF NOT EXISTS is_hourly_billing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hourly_billing_rate_nok NUMERIC(10, 2)
    CHECK (hourly_billing_rate_nok IS NULL OR hourly_billing_rate_nok >= 0);

COMMENT ON COLUMN public.projects.approved_hours IS
  'Manuell overstyring av godkjente timer fra kunde. NULL = bruk timer fra aksepterte tilbud i stedet.';
COMMENT ON COLUMN public.projects.is_hourly_billing IS
  'Løpende timebasert prosjekt: omsetning inkluderer førte timer × hourly_billing_rate_nok.';
COMMENT ON COLUMN public.projects.hourly_billing_rate_nok IS
  'Timepris til kunde (kr/t, eks. mva) for løpende timebasert fakturering. NULL = ikke satt.';
