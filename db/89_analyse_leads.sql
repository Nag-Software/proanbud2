-- ============================================================================
-- 89_analyse_leads.sql
-- ----------------------------------------------------------------------------
-- Firmaer som har analysert nettsiden sin på proanbud.no/analyse
-- (eksempeltilbud-flyten). Markedssiden skriver leadet til Sanity
-- (`exampleLead`) i det analysen starter; /sjefen/analyserte speiler dem hit
-- (lib/analyse-leads/sync.ts) og kobler dem mot kontoer og firmaer, så vi ser
-- hvem som faktisk onboardet seg.
--
-- id = Sanity-dokumentets _id (hash av e-post + domene), så synken er en ren
-- upsert og kan kjøres så ofte vi vil.
--
-- Onboarding-status lagres IKKE her — den regnes ut ved lesing mot
-- auth.users / users / companies / company_billing, så den aldri blir utdatert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS analyse_leads (
  id text PRIMARY KEY,
  email text NOT NULL,
  website text,
  domain text,
  status text,
  manual boolean NOT NULL DEFAULT false,
  -- Det analysen fant på nettsiden
  company_name text,
  location text,
  phone text,
  company_email text,
  has_logo boolean,
  services text[] NOT NULL DEFAULT '{}',
  detected_trade text,
  trade_confidence numeric,
  -- Eksempeltilbudet
  asked_questions boolean,
  trade text,
  job_title text,
  offer_total integer,
  email_sent boolean,
  -- Sporing
  utm text,
  referral_code text,
  submitted_at timestamptz,
  completed_at timestamptz,
  -- Synk
  sanity_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analyse_leads_submitted_at_idx
  ON analyse_leads (submitted_at DESC);
CREATE INDEX IF NOT EXISTS analyse_leads_email_idx
  ON analyse_leads (lower(email));
CREATE INDEX IF NOT EXISTS analyse_leads_domain_idx
  ON analyse_leads (domain);

ALTER TABLE analyse_leads ENABLE ROW LEVEL SECURITY;
-- Ingen policies: kun service-role (sjefen) leser og skriver her.
