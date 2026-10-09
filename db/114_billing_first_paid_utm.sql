-- 114_billing_first_paid_utm.sql
-- To ting vekstmålingen manglet:
--
--   1. company_billing.first_paid_at — første gang abonnementet ble `active`
--      (betalende). Settes ÉN gang av billing-synken (lib/billing/sync.ts) med
--      en betinget UPDATE (… WHERE first_paid_at IS NULL), slik at
--      webhook-retry og kappløpet webhook ↔ confirm-checkout aldri gir to
--      «betaling_fullfort»-events. past_due → active (dunning) stempler ikke
--      på nytt. Brukes også som «betalende siden» på /sjefen/abonnement.
--
--   2. UTM/første berøring på companies — hvor bedriften kom fra. Fanges som
--      førsteparts-cookie `pa_utm` (app-middleware og markedssiden) og skrives
--      på bedriften i POST /api/companies, samme mønster som pa_ref (db/56) og
--      __oppref (db/95). Separate kolonner, ikke jsonb: /sjefen grupperer på
--      utm_source. Første berøring vinner; kolonnene skrives aldri over.
--
-- Additiv: kan kjøres i prod før koden deployes (koden tåler 42703 = kolonne
-- mangler). Safe to run repeatedly.

ALTER TABLE public.company_billing
  ADD COLUMN IF NOT EXISTS first_paid_at TIMESTAMPTZ;

COMMENT ON COLUMN public.company_billing.first_paid_at IS
  'Første gang abonnementet ble active (betalende). Settes én gang av billing-synken; NULL = har aldri betalt.';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_landing_path TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_referrer_host TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_click_network TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_click_id TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_first_touch_at TIMESTAMPTZ;

COMMENT ON COLUMN public.companies.utm_source IS
  'Første berøring (pa_utm-cookie) ved firmaopprettelse. Skrives aldri over.';
COMMENT ON COLUMN public.companies.acquisition_click_network IS
  'Annonsenett klikk-ID-en tilhører: google (gclid/gbraid/wbraid), meta (fbclid), tiktok (ttclid), microsoft (msclkid).';

CREATE INDEX IF NOT EXISTS companies_utm_source_idx
  ON public.companies (utm_source)
  WHERE utm_source IS NOT NULL;
