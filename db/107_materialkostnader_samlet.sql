-- 107_materialkostnader_samlet.sql
-- Én tabell for alle materialkostnader på et prosjekt: det håndverkeren legger inn
-- selv OG det som er bokført på prosjektet i regnskapet (Fiken/Tripletex).
--
-- Før dette lå regnskapets kostnader i en egen tabell (project_accounting_costs, db/105)
-- med en alt-eller-ingenting-regel: fantes det én bokført kostnad, ble ALLE manuelle
-- poster holdt utenfor. Det ga to lister i appen og feil tall så snart bare noen av
-- innkjøpene var bokført.
--
-- Nå:
--   * source = 'manual' | 'fiken' | 'tripletex'. Bokførte rader skrives bare av
--     synk-workeren (service role); brukeren kan ikke endre eller slette dem.
--   * replaced_by — en manuell post som er funnet igjen som bokført kostnad peker på
--     den bokførte raden, og telles ikke (samme kjøp skal telles én gang). Slettes
--     den bokførte raden i regnskapet, settes feltet til NULL og den manuelle teller igjen.
--   * keep_separate — brukeren har sagt «ikke samme kjøp»: aldri koble automatisk.
--
-- project_accounting_cost_syncs (sist hentet) blir stående — den er hentestatus, ikke kostnader.
-- Safe to run repeatedly.

ALTER TABLE public.project_material_costs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS account_name TEXT,
  ADD COLUMN IF NOT EXISTS voucher_ref TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES public.project_material_costs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS keep_separate BOOLEAN NOT NULL DEFAULT false;

-- Kreditnotaer fra regnskapet er negative; manuelle poster skal fortsatt være ≥ 0.
ALTER TABLE public.project_material_costs DROP CONSTRAINT IF EXISTS project_material_costs_amount_nok_check;
ALTER TABLE public.project_material_costs ALTER COLUMN amount_nok TYPE NUMERIC(14, 2);

ALTER TABLE public.project_material_costs DROP CONSTRAINT IF EXISTS project_material_costs_source_check;
ALTER TABLE public.project_material_costs ADD CONSTRAINT project_material_costs_source_check
  CHECK (source IN ('manual', 'fiken', 'tripletex'));

ALTER TABLE public.project_material_costs DROP CONSTRAINT IF EXISTS project_material_costs_manual_amount_check;
ALTER TABLE public.project_material_costs ADD CONSTRAINT project_material_costs_manual_amount_check
  CHECK (source <> 'manual' OR amount_nok >= 0);

-- Bokførte rader har alltid en id i regnskapet; manuelle har aldri.
ALTER TABLE public.project_material_costs DROP CONSTRAINT IF EXISTS project_material_costs_external_id_check;
ALTER TABLE public.project_material_costs ADD CONSTRAINT project_material_costs_external_id_check
  CHECK ((source = 'manual') = (external_id IS NULL));

-- Bare manuelle poster kan erstattes av en bokført.
ALTER TABLE public.project_material_costs DROP CONSTRAINT IF EXISTS project_material_costs_replaced_by_check;
ALTER TABLE public.project_material_costs ADD CONSTRAINT project_material_costs_replaced_by_check
  CHECK (replaced_by IS NULL OR source = 'manual');

-- Synk-nøkkelen. Manuelle rader har external_id NULL og kolliderer derfor aldri.
ALTER TABLE public.project_material_costs DROP CONSTRAINT IF EXISTS project_material_costs_source_external_key;
ALTER TABLE public.project_material_costs ADD CONSTRAINT project_material_costs_source_external_key
  UNIQUE (company_id, source, external_id);

CREATE INDEX IF NOT EXISTS idx_project_material_costs_project_date
  ON public.project_material_costs (project_id, cost_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_material_costs_replaced_by
  ON public.project_material_costs (replaced_by);

-- Flytt det som allerede er hentet (tomt i prod 2026-10-01, men trygt å kjøre).
DO $$
BEGIN
  IF to_regclass('public.project_accounting_costs') IS NOT NULL THEN
    INSERT INTO public.project_material_costs (
      company_id, project_id, source, external_id, cost_date, account_number, account_name,
      supplier_name, description, voucher_ref, amount_nok, synced_at
    )
    SELECT company_id, project_id, provider, external_id, cost_date, account_number, account_name,
           supplier_name, description, voucher_ref, amount_nok, synced_at
    FROM public.project_accounting_costs
    ON CONFLICT (company_id, source, external_id) DO NOTHING;

    DROP TABLE public.project_accounting_costs;
  END IF;
END $$;

-- RLS: medlemmer leser alt, men skriver bare manuelle poster. Bokførte rader eies av
-- regnskapet og skrives av workeren (service role, forbi RLS).
DROP POLICY IF EXISTS "company_members_insert_project_material_costs" ON public.project_material_costs;
CREATE POLICY "company_members_insert_project_material_costs" ON public.project_material_costs
  FOR INSERT
  WITH CHECK (company_id = (SELECT public.get_current_company_id()) AND source = 'manual');

DROP POLICY IF EXISTS "company_members_update_project_material_costs" ON public.project_material_costs;
CREATE POLICY "company_members_update_project_material_costs" ON public.project_material_costs
  FOR UPDATE
  USING (company_id = (SELECT public.get_current_company_id()) AND source = 'manual')
  WITH CHECK (company_id = (SELECT public.get_current_company_id()) AND source = 'manual');

DROP POLICY IF EXISTS "company_members_delete_project_material_costs" ON public.project_material_costs;
CREATE POLICY "company_members_delete_project_material_costs" ON public.project_material_costs
  FOR DELETE
  USING (company_id = (SELECT public.get_current_company_id()) AND source = 'manual');

COMMENT ON TABLE public.project_material_costs IS
  'Alle materialkostnader på prosjektet: manuelle (source=manual) og bokførte fra regnskapet (fiken/tripletex, skrives kun av synk-workeren).';
COMMENT ON COLUMN public.project_material_costs.replaced_by IS
  'Manuell post som er bokført i regnskapet: peker på den bokførte raden og telles ikke.';
