-- Invoice lifecycle on contracts (ProAnbud source of truth, synced from Tripletex when possible)

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS invoice_status TEXT NOT NULL DEFAULT 'none'
    CHECK (invoice_status IN ('none', 'pending', 'created', 'sent', 'paid', 'error')),
  ADD COLUMN IF NOT EXISTS invoice_external_id TEXT,
  ADD COLUMN IF NOT EXISTS invoice_external_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contracts_invoice_status
  ON public.contracts(company_id, invoice_status);
