-- 96_company_offer_defaults.sql
-- Bedriftens standard prismodell og kontraktsgrunnlag for nye tilbud.
--
-- Før dette ble prismodellen gjettet ut fra linjene hver gang man gikk til
-- «Se over og send» (én linje i timer → hele tilbudet ble «Regningsarbeid»),
-- uten at brukeren så det eller kunne endre det. Nå velges den eksplisitt i
-- tilbudet, og disse kolonnene gir startverdien.
--
-- Regningsarbeid er standard: summen i tilbudet blir da et prisoverslag, ikke en
-- fast pris håndverkeren er bundet av. Fastpris må velges aktivt.
--
-- Koden leser kolonnene i en egen spørring og tåler at migrasjonen ikke er kjørt
-- (faller tilbake til regningsarbeid / ingen standard).
-- Safe to run repeatedly.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_pricing_model TEXT NOT NULL DEFAULT 'time_materials';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_contract_basis TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_default_pricing_model_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_default_pricing_model_check
      CHECK (default_pricing_model IN ('fixed', 'time_materials'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_default_contract_basis_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_default_contract_basis_check
      CHECK (default_contract_basis IN ('ns8405', 'ns8407', 'custom', 'none'));
  END IF;
END $$;

COMMENT ON COLUMN public.companies.default_pricing_model IS
  'Standard prismodell for nye tilbud: time_materials (regningsarbeid, standard) eller fixed (fastpris).';
COMMENT ON COLUMN public.companies.default_contract_basis IS
  'Standard kontraktsgrunnlag for nye tilbud: none, ns8405, ns8407 eller custom.';
