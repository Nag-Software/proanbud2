export type AffiliateStatus = "pending" | "approved" | "paused" | "rejected"

/** A row from the `affiliate_partners` table (henvisningspartnere). */
export type AffiliatePartnerRow = {
  id: string
  contact_name: string
  email: string
  phone: string | null
  company_name: string | null
  org_number: string | null
  channel: string | null
  source: string | null
  referral_code: string
  status: AffiliateStatus
  notes: string | null
  clicks: number
  signups: number
  active_customers: number
  mrr_nok: number
  total_earned_nok: number
  applied_at: string
  created_at: string
  updated_at: string
}

/** Payload accepted by POST /api/affiliate/apply (from the marketing form). */
export type AffiliateApplicationInput = {
  contactName: string
  email: string
  phone?: string
  companyName?: string
  orgNr?: string
  channel?: string
  source?: string
}
