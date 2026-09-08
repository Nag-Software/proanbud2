-- 86_fiken_bank_account_number.sql
-- Bankkontonummeret Fiken skal sette på fakturaen.
--
-- Tre felt heter nesten det samme i Fikens API, og bare ett virker på et fakturautkast:
--   bankAccountCode   «1920:10001»  → finnes IKKE i invoiceishDraftRequest (ignorert)
--   paymentAccount    «1920:10001»  → kun for drafts av type CASH_INVOICE (HTTP 400)
--   bankAccountNumber «15035646830» → RIKTIG felt for et vanlig fakturautkast
--
-- Uten det resolver Fiken kontoen til null og avviser ferdigstillingen med HTTP 403:
-- «The bank account number null has not been verified as belonging to this company.»
--
-- Egen kolonne fordi den eksisterende `default_bank_account_code` er ment for
-- kontokoden («1920:XXXXX»), ikke kontonummeret. Å gjenbruke den ville etterlatt et
-- felt hvis navn lyver om innholdet.
-- Safe to run repeatedly.

ALTER TABLE public.fiken_connections
  ADD COLUMN IF NOT EXISTS default_bank_account_number TEXT;

COMMENT ON COLUMN public.fiken_connections.default_bank_account_number IS
  'Kontonummer (bankAccountNumber) som sendes på fakturautkast. Må være Altinn-bekreftet i Fiken.';
COMMENT ON COLUMN public.fiken_connections.default_bank_account_code IS
  'UBRUKT. Kontokode «1920:XXXXX» — gjelder kun POST /invoices og CASH_INVOICE-utkast.';
