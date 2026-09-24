-- 97_saved_job_hours.sql
-- Timeantall på lagrede fastprisjobber («Fast jobb»).
--
-- En lagret jobb står i tilbudet som én fastprislinje. Uten timer kunne den ikke
-- telle med i timekalkylen («Timeforbruk mot kalkyle»), så førte timer på et
-- prosjekt med fastprisjobber hadde ingenting å sammenlignes med. Timene følger
-- med inn i tilbudslinjen som plannedHours.
--
-- NULL = ikke satt (eldre jobber). Koden leser kolonnen med fallback og tåler at
-- migrasjonen ikke er kjørt.
-- Safe to run repeatedly.

ALTER TABLE public.saved_jobs
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(8, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_jobs_estimated_hours_check'
  ) THEN
    ALTER TABLE public.saved_jobs
      ADD CONSTRAINT saved_jobs_estimated_hours_check
      CHECK (estimated_hours IS NULL OR estimated_hours >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.saved_jobs.estimated_hours IS
  'Beregnet antall arbeidstimer for jobben. Følger med i tilbudslinjen (plannedHours) og teller i timekalkylen.';
