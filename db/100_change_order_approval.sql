-- Tilleggsarbeid (change_orders): kundegodkjenning via lenke igjen, med bevis.
--
-- Flyt:
--  1. Håndverkeren oppretter en ekstrajobb og enten
--     a) sender den til kunden («Send til godkjenning») → status 'sent', eller
--     b) registrerer den som allerede avtalt → status 'accepted' med et grunnlag
--        (muntlig avtalt på stedet, hastearbeid etter håndverkertjenesteloven § 9,
--        eller avtalt skriftlig et annet sted).
--  2. Kunden åpner lenken, skriver navn og taster en engangskode sendt til
--     e-posten → status 'accepted' med bevis (navn, e-post, IP, tidspunkt og
--     SHA-256 av tekst og beløp). Eller avslår → 'rejected'.
--
-- Kodefeltene er flyktige og nulles ved godkjenning (samme mønster som db/64
-- for tilbud): kun sha256(id:kode) lagres, gyldig 10 min, maks 5 forsøk.

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accept_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS accept_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accept_code_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accept_code_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS accepted_email TEXT,
  ADD COLUMN IF NOT EXISTS accepted_ip TEXT,
  ADD COLUMN IF NOT EXISTS accepted_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS accepted_document_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS approval_basis TEXT,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'change_orders_approval_basis_check'
  ) THEN
    ALTER TABLE public.change_orders
      ADD CONSTRAINT change_orders_approval_basis_check
      CHECK (
        approval_basis IS NULL
        OR approval_basis IN ('customer_otp', 'agreed_on_site', 'urgent_work', 'agreed_in_writing')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.change_orders.approval_basis IS
  'Hvordan kunden samtykket: customer_otp (godkjent via lenke med engangskode), agreed_on_site (muntlig på stedet), urgent_work (hastearbeid, hvtjl. § 9), agreed_in_writing (e-post/SMS). NULL = registrert før dette feltet fantes.';
