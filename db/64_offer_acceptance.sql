-- Digital aksept av tilbud med engangskode (e-post-OTP) + bevispakke.
--
-- Flyt: kunden ber om engangskode (sendes KUN til e-posten tilbudet ble sendt
-- til), taster koden og aksepterer. Da fryses tilbudsinnholdet i en snapshot
-- (accepted_snapshot) med SHA-256-hash, og identitetsbeviset lagres på raden.
-- Tilbuds-PDF-en rendres fra snapshoten etter aksept og viser bevisblokken i
-- stedet for signaturlinjer — dokumentet ER avtalen.
--
-- Kodefeltene er flyktige og nulles ved vellykket aksept:
--  - accept_code_hash: sha256(offerId + ':' + kode), aldri koden i klartekst
--  - accept_code_expires_at: 10 minutter etter utsendelse
--  - accept_code_sent_at: brukes til 60 s resend-cooldown
--  - accept_code_attempts: maks 5 feilforsøk før ny kode kreves

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accept_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS accept_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accept_code_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accept_code_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS accepted_email TEXT,
  ADD COLUMN IF NOT EXISTS accepted_ip TEXT,
  ADD COLUMN IF NOT EXISTS accepted_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS accepted_method TEXT
    CHECK (accepted_method IN ('email_otp')),
  ADD COLUMN IF NOT EXISTS accepted_document_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS accepted_snapshot JSONB;
