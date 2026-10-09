-- 115_employee_hourly_rates.sql
-- Kobler hver ansatt til én timepris (Mine priser → Timepriser), og dermed til
-- en kostpris per time.
--
-- Bakgrunn: lønnskosten på prosjektenes lønnsomhet ble regnet med SNITTET av
-- alle kostprisene i bedriften (lib/job-costing/calc.ts averageCostRate). En
-- lærling og en bas kostet det samme, og prosjekter med bare lærlinger fikk for
-- høy lønnskost (og omvendt). Nå regnes hver ansatts timer med kostprisen på
-- timeprisen hen er koblet til; ansatte uten kobling regnes fortsatt med snittet,
-- og UI sier det.
--
-- Egen tabell, ikke en kolonne på users: users leses av alle i bedriften, og en
-- kolonne der hadde latt håndverkere utlede kollegers kostpris. Her leser bare
-- leder/admin, og bare service role skriver (server action med admin-sjekk).
--
-- Ingen historikk i v1: endres kostprisen på en timepris, gjelder den også
-- timer som allerede er ført. Det står i UI-et.
-- Safe to run repeatedly.

-- Sammensatte nøkler, så en kobling aldri kan peke på en annen bedrifts
-- bruker eller timepris — det gjelder også skriving med service role.
CREATE UNIQUE INDEX IF NOT EXISTS hourly_rates_id_company_uidx
  ON public.hourly_rates (id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_id_company_uidx
  ON public.users (id, company_id);

CREATE TABLE IF NOT EXISTS public.employee_hourly_rates (
  user_id        UUID PRIMARY KEY,
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  hourly_rate_id UUID NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT employee_hourly_rates_user_company_fkey
    FOREIGN KEY (user_id, company_id)
    REFERENCES public.users (id, company_id) ON DELETE CASCADE,
  -- Slettes timeprisen, forsvinner koblingen: den ansatte regnes med snittet
  -- til hen kobles på nytt. Slettedialogen i UI sier det.
  CONSTRAINT employee_hourly_rates_rate_company_fkey
    FOREIGN KEY (hourly_rate_id, company_id)
    REFERENCES public.hourly_rates (id, company_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS employee_hourly_rates_company_rate_idx
  ON public.employee_hourly_rates (company_id, hourly_rate_id);

ALTER TABLE public.employee_hourly_rates ENABLE ROW LEVEL SECURITY;

-- Lesing: leder og admin i egen bedrift. Kostpris per ansatt er i praksis
-- lønnsdata, og en håndverker skal ikke se kollegers.
DROP POLICY IF EXISTS managers_select_employee_hourly_rates ON public.employee_hourly_rates;
CREATE POLICY managers_select_employee_hourly_rates ON public.employee_hourly_rates
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT public.get_current_company_id())
    AND (SELECT public.is_company_manager_or_admin())
  );

-- Ingen INSERT/UPDATE/DELETE-policy for authenticated: all skriving går via
-- service role i server action (app/mine-priser/timepriser/actions.ts), etter
-- admin- og samme-bedrift-sjekk i kode.
REVOKE INSERT, UPDATE, DELETE ON public.employee_hourly_rates FROM anon, authenticated;

DROP POLICY IF EXISTS active_authenticated_user ON public.employee_hourly_rates;
CREATE POLICY active_authenticated_user ON public.employee_hourly_rates
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

COMMENT ON TABLE public.employee_hourly_rates IS
  'Hvilken timepris (og dermed kostpris) en ansatt regnes med i prosjektøkonomien. Én per ansatt; ingen historikk i v1.';
COMMENT ON COLUMN public.employee_hourly_rates.hourly_rate_id IS
  'Timeprisen den ansatte jobber til. Kostprisen på den brukes på alle timer den ansatte fører.';
