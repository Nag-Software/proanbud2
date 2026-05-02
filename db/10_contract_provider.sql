-- Add contract_provider to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contract_provider TEXT CHECK (contract_provider IN ('docusign', 'tripletex'));
