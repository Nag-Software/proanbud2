-- ============================================================================
-- 55_affiliate_partners.sql
-- ----------------------------------------------------------------------------
-- Henvisningspartnere ("Bli selger"). Søknader som sendes inn fra
-- markedssidens /bli-selger-skjema lander her via det offentlige endepunktet
-- POST /api/affiliate/apply, og vises/administreres i /sjefen/selgere.
--
-- Ytelsesfeltene (clicks → total_earned_nok) eies av henvisningsmotoren som
-- knytter signup-er til referral_code. Inntil den er på plass står de på 0 og
-- /sjefen/selgere viser «ingen aktivitet ennå».
--
-- NB: ikke til forveksling med seller_* / selger-arbeidsflyten (kundemaskinen),
-- som handler om interne selgere/SDR-er — dette er eksterne affiliate-partnere.
-- ============================================================================

CREATE TABLE IF NOT EXISTS affiliate_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text,
  company_name text,
  org_number text,
  channel text,
  source text,
  referral_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paused', 'rejected')),
  notes text,
  -- Ytelse (synkes fra henvisningsmotoren senere)
  clicks integer NOT NULL DEFAULT 0,
  signups integer NOT NULL DEFAULT 0,
  active_customers integer NOT NULL DEFAULT 0,
  mrr_nok integer NOT NULL DEFAULT 0,
  total_earned_nok integer NOT NULL DEFAULT 0,
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_partners_applied_at_idx
  ON affiliate_partners (applied_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_partners_status_idx
  ON affiliate_partners (status);

-- updated_at vedlikeholdes av trigger.
CREATE OR REPLACE FUNCTION set_affiliate_partners_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliate_partners_set_updated_at ON affiliate_partners;
CREATE TRIGGER affiliate_partners_set_updated_at
  BEFORE UPDATE ON affiliate_partners
  FOR EACH ROW EXECUTE FUNCTION set_affiliate_partners_updated_at();

ALTER TABLE affiliate_partners ENABLE ROW LEVEL SECURITY;
-- Ingen policies: kun service-role / plattform-API-er leser og skriver her.
