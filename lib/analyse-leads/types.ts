/**
 * Hvor langt et analysert firma har kommet i onboardingen, regnet ut ved
 * lesing mot auth.users / users / companies / company_billing.
 */
export type OnboardingStage =
  | "none" // Ingen konto med e-posten, og ingen firma på domenet
  | "account" // Konto opprettet, men firmaoppsettet er ikke fullført
  | "company" // Firma opprettet, uten prøveperiode eller abonnement
  | "trial" // I prøveperiode
  | "paying" // Aktivt abonnement
  | "churned" // Abonnementet er avsluttet eller ubetalt

export type OnboardingMatch = {
  stage: OnboardingStage
  /** Hvordan leadet ble koblet til kontoen/firmaet. */
  matched_by: "email" | "domain" | null
  account_created_at: string | null
  last_sign_in_at: string | null
  company: {
    id: string
    name: string
    created_at: string
    plan_key: string | null
    billing_status: string | null
    trial_ends_at: string | null
    offer_count: number
    last_seen_at: string | null
  } | null
}

/** En rad fra `analyse_leads` pluss utregnet onboarding-status. */
export type AnalyseLeadRow = {
  id: string
  email: string
  website: string | null
  domain: string | null
  status: string | null
  manual: boolean
  company_name: string | null
  location: string | null
  phone: string | null
  company_email: string | null
  has_logo: boolean | null
  services: string[]
  detected_trade: string | null
  trade_confidence: number | null
  asked_questions: boolean | null
  trade: string | null
  job_title: string | null
  offer_total: number | null
  email_sent: boolean | null
  utm: string | null
  referral_code: string | null
  submitted_at: string | null
  completed_at: string | null
  onboarding: OnboardingMatch
}

export type AnalyseLeadsSyncResult =
  | { ok: true; synced: number }
  | { ok: false; error: string }
