-- Onboarding fields collected in the "Opprett din bedrift"-stepper that were
-- previously discarded silently. Persist them on companies so the data is kept.
-- - employees: antall ansatte (fritekst fra Brreg/manuell)
-- - turnover: årlig omsetning (fritekst)
-- - main_supplier: hovedleverandør (fritekst)
-- - signup_source: markedsføringskilde ("hvordan hørte du om oss?") for onboarding-attribusjon

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS employees TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS turnover TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS main_supplier TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS signup_source TEXT;
