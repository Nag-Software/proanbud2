-- ============================================================================
-- 76_project_budget_progress.sql
-- ----------------------------------------------------------------------------
-- Mål og framdrift per prosjekt, for lønnsomhetsfanen.
--
--   budgeted_hours / budgeted_material_nok
--       Fastprisjobber har ingen kalkyle å måle mot: tilbudet sier hva kunden
--       betaler, ikke hva jobben skal koste. Uten et mål blir «kalkyle mot
--       faktisk» tom for flertallet av brukerne. Disse to feltene er målet
--       prosjektlederen selv setter, og brukes som kalkyle når tilbudslinjene
--       ikke gir kostgrunnlag.
--
--   progress_percent
--       Hvor langt jobben er kommet, satt manuelt. Grunnlaget for prognosen
--       («med dette forbruket ender jobben på X»). Bevisst manuelt: å utlede
--       framdrift fra oppgaver folk ikke fører ville gitt en prognose som ser
--       presis ut uten å være det.
--
-- NULL betyr «ikke satt» i alle tre — det er en ekte tilstand som skiller seg
-- fra 0, og UI-et viser den som «ikke satt», ikke som null kroner/null prosent.
--
-- Idempotent: trygg å kjøre om igjen.
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budgeted_hours NUMERIC(10, 2)
    CHECK (budgeted_hours IS NULL OR budgeted_hours >= 0),
  ADD COLUMN IF NOT EXISTS budgeted_material_nok NUMERIC(14, 2)
    CHECK (budgeted_material_nok IS NULL OR budgeted_material_nok >= 0),
  ADD COLUMN IF NOT EXISTS progress_percent SMALLINT
    CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100));

COMMENT ON COLUMN public.projects.budgeted_hours IS
  'Budsjetterte timer. NULL = ikke satt. Kalkylegrunnlag for fastprisjobber.';
COMMENT ON COLUMN public.projects.budgeted_material_nok IS
  'Budsjettert materialkost eks. mva. NULL = ikke satt.';
COMMENT ON COLUMN public.projects.progress_percent IS
  'Manuelt satt framdrift 0-100. NULL = ikke satt. Grunnlag for prognose.';
