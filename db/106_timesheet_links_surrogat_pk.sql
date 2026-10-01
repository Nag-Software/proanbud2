-- 106_timesheet_links_surrogat_pk.sql
-- Retter at /sjefen/firmaer viste 0 firmaer etter db/105.
--
-- accounting_timesheet_links hadde en sammensatt primærnøkkel med company_id,
-- user_id og project_id. PostgREST tolker da tabellen som en koblingstabell
-- (mange-til-mange) mellom companies↔users, companies↔projects og users↔projects,
-- og hver innebygging som `companies?select=users(...)` feiler med PGRST201
-- («more than one relationship was found»).
--
-- Løsning: egen id som primærnøkkel, og den gamle nøkkelen som UNIQUE. Upserten i
-- lib/integrations/tripletex/timesheet.ts bruker onConflict på de samme kolonnene,
-- og det fungerer like godt mot en UNIQUE-constraint.
--
-- Safe to run repeatedly.

ALTER TABLE public.accounting_timesheet_links
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounting_timesheet_links'::regclass
      AND conname = 'accounting_timesheet_links_pkey'
      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (id)'
  ) THEN
    ALTER TABLE public.accounting_timesheet_links DROP CONSTRAINT accounting_timesheet_links_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounting_timesheet_links'::regclass
      AND conname = 'accounting_timesheet_links_key'
  ) THEN
    ALTER TABLE public.accounting_timesheet_links
      ADD CONSTRAINT accounting_timesheet_links_key
      UNIQUE (company_id, provider, user_id, project_id, entry_date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounting_timesheet_links'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.accounting_timesheet_links
      ADD CONSTRAINT accounting_timesheet_links_pkey PRIMARY KEY (id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
