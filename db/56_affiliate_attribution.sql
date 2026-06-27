-- ============================================================================
-- 56_affiliate_attribution.sql
-- ----------------------------------------------------------------------------
-- Kobler henvisningspartnere ([[55_affiliate_partners]]) til faktiske signups.
--
--   companies.affiliate_partner_id   — selgeren som vervet firmaet (pa_ref-cookien
--                                      ved firmaopprettelse i POST /api/companies).
--   companies.affiliate_ref_code     — rå henvisningskode (revisjon / sen-binding).
--   companies.affiliate_attributed_at— når attribusjonen ble satt.
--
-- Registreringer / aktive kunder / provisjon på /sjefen/selgere beregnes live fra
-- disse koblingene + company_billing (se lib/affiliate/queries.ts). Klikk telles
-- via bump_affiliate_clicks() når markedssidens /r/<kode> pinger
-- /api/affiliate/click.
-- ============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS affiliate_partner_id uuid
    REFERENCES affiliate_partners(id) ON DELETE SET NULL;
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS affiliate_ref_code text;
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS affiliate_attributed_at timestamptz;

CREATE INDEX IF NOT EXISTS companies_affiliate_partner_id_idx
  ON companies (affiliate_partner_id)
  WHERE affiliate_partner_id IS NOT NULL;

-- Atomisk klikkteller. No-op hvis koden er ukjent. SECURITY DEFINER så det
-- offentlige klikk-endepunktet kan kalle den uten RLS-tilgang til tabellen.
CREATE OR REPLACE FUNCTION bump_affiliate_clicks(p_code text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE affiliate_partners
  SET clicks = clicks + 1, updated_at = now()
  WHERE referral_code = lower(trim(p_code));
$$;
