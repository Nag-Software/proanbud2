-- Tripletex as contract signing provider (customer signs via ProAnbud portal)

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_signing_provider_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_signing_provider_check
    CHECK (signing_provider IN ('docusign', 'tripletex', 'manual', 'none'));

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_signing_provider_check;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_signing_provider_check
    CHECK (signing_provider IN ('docusign', 'tripletex', 'manual', 'none'));

UPDATE public.companies
SET signing_provider = 'tripletex'
WHERE contract_provider = 'tripletex' AND signing_provider IN ('none', 'manual');
