import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { baseFromApplication, normalizeCode, randomSuffix } from "./referral-code"
import type {
  AffiliateApplicationInput,
  AffiliatePartnerRow,
  AffiliateStatus,
} from "./types"

const AFFILIATE_STATUSES: AffiliateStatus[] = [
  "pending",
  "approved",
  "paused",
  "rejected",
]

export function isAffiliateStatus(value: unknown): value is AffiliateStatus {
  return typeof value === "string" && AFFILIATE_STATUSES.includes(value as AffiliateStatus)
}

async function codeExists(admin: SupabaseClient, code: string): Promise<boolean> {
  const { data, error } = await admin
    .from("affiliate_partners")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle()
  if (error) throw new Error(`Kunne ikke sjekke henvisningskode: ${error.message}`)
  return Boolean(data)
}

/** Generate a referral code that is not yet taken. */
async function generateReferralCode(
  admin: SupabaseClient,
  input: AffiliateApplicationInput,
): Promise<string> {
  const base = baseFromApplication(input)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate =
      attempt === 0 ? base : normalizeCode(`${base}-${randomSuffix()}`) ?? base
    if (!(await codeExists(admin, candidate))) return candidate
  }
  return normalizeCode(`${base}-${randomSuffix(8)}`) ?? `selger-${randomSuffix(8)}`
}

export type CreatedAffiliatePartner = { id: string; referralCode: string }

/** Insert a new affiliate-partner application. Service-role only. */
export async function createAffiliatePartner(
  input: AffiliateApplicationInput,
): Promise<CreatedAffiliatePartner> {
  const admin = createAdminClient()
  const referralCode = await generateReferralCode(admin, input)

  const { data, error } = await admin
    .from("affiliate_partners")
    .insert({
      contact_name: input.contactName,
      email: input.email,
      phone: input.phone || null,
      company_name: input.companyName || null,
      org_number: input.orgNr || null,
      channel: input.channel || null,
      source: input.source || "bli-selger",
      referral_code: referralCode,
      status: "pending",
    })
    .select("id")
    .single()

  if (error || !data) {
    throw new Error(`Kunne ikke lagre selger-søknad: ${error?.message ?? "ukjent feil"}`)
  }

  return { id: data.id, referralCode }
}

/** All affiliate partners, newest application first. */
export async function fetchAffiliatePartners(): Promise<AffiliatePartnerRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("affiliate_partners")
    .select("*")
    .order("applied_at", { ascending: false })

  if (error) {
    await logServerError({
      message: "Kunne ikke hente selgere (affiliate)",
      error,
      source: "server",
      route: "fetchAffiliatePartners",
    })
    return []
  }
  return (data ?? []) as AffiliatePartnerRow[]
}

/** Update an affiliate partner's status and/or internal notes. */
export async function updateAffiliatePartner(
  id: string,
  patch: { status?: AffiliateStatus; notes?: string },
): Promise<void> {
  const admin = createAdminClient()
  const update: Record<string, unknown> = {}
  if (patch.status) update.status = patch.status
  if (patch.notes !== undefined) update.notes = patch.notes
  if (Object.keys(update).length === 0) return

  const { error } = await admin.from("affiliate_partners").update(update).eq("id", id)
  if (error) throw new Error(`Kunne ikke oppdatere selger: ${error.message}`)
}
