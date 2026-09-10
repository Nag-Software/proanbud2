import type { SupabaseClient } from "@supabase/supabase-js"

import { sanityFetchWithToken } from "@/lib/sanity/api"
import type { AnalyseLeadsSyncResult } from "@/lib/analyse-leads/types"

/**
 * Speiler `exampleLead`-dokumentene fra Sanity (skrevet av proanbud.no/analyse)
 * inn i `analyse_leads`. Inkrementell: henter bare dokumenter endret siden
 * forrige synk, så den er billig nok til å kjøres hver gang /sjefen/analyserte
 * lastes. Første kjøring henter alt (backfill).
 *
 * Leadene har punktum i _id (`exampleLead.<hash>`) og er derfor private i
 * Sanity — de krever token å lese, også i et offentlig datasett.
 */

type SanityExampleLead = {
  _id: string
  _updatedAt: string
  email?: string
  website?: string
  domain?: string
  status?: string
  manual?: boolean
  companyName?: string
  location?: string
  phone?: string
  companyEmail?: string
  hasLogo?: boolean
  services?: string[]
  detectedTrade?: string
  tradeConfidence?: number
  askedQuestions?: boolean
  trade?: string
  jobTitle?: string
  offerTotal?: number
  emailSent?: boolean
  utm?: string
  referralCode?: string
  submittedAt?: string
  completedAt?: string
}

// dateTime() på begge sider: uten den sammenligner GROQ tekst, og Postgres'
// «+00:00» mot Sanitys «Z» ville gjort at siste lead ble hentet på nytt hver gang.
const LEADS_QUERY = `*[_type == "exampleLead" && !(_id in path("drafts.**")) && dateTime(_updatedAt) > dateTime($since)]
  | order(_updatedAt asc) {
    _id, _updatedAt, email, website, domain, status, manual, companyName, location,
    phone, companyEmail, hasLogo, services, detectedTrade, tradeConfidence,
    askedQuestions, trade, jobTitle, offerTotal, emailSent, utm, referralCode,
    submittedAt, completedAt
  }`

/** En treg Sanity skal ikke holde sjefen-siden igjen. */
const SYNC_TIMEOUT_MS = 5_000

function toRow(doc: SanityExampleLead) {
  return {
    id: doc._id,
    email: (doc.email ?? "").trim().toLowerCase(),
    website: doc.website || null,
    domain: doc.domain || null,
    status: doc.status || null,
    manual: Boolean(doc.manual),
    company_name: doc.companyName || null,
    location: doc.location || null,
    phone: doc.phone || null,
    company_email: doc.companyEmail || null,
    has_logo: doc.hasLogo ?? null,
    services: doc.services ?? [],
    detected_trade: doc.detectedTrade || null,
    trade_confidence: doc.tradeConfidence ?? null,
    asked_questions: doc.askedQuestions ?? null,
    trade: doc.trade || null,
    job_title: doc.jobTitle || null,
    offer_total: typeof doc.offerTotal === "number" ? Math.round(doc.offerTotal) : null,
    email_sent: doc.emailSent ?? null,
    utm: doc.utm || null,
    referral_code: doc.referralCode || null,
    submitted_at: doc.submittedAt || null,
    completed_at: doc.completedAt || null,
    sanity_updated_at: doc._updatedAt,
    synced_at: new Date().toISOString(),
  }
}

async function runSync(admin: SupabaseClient): Promise<number> {
  const { data: latest, error: latestError } = await admin
    .from("analyse_leads")
    .select("sanity_updated_at")
    .order("sanity_updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (latestError) throw new Error(latestError.message)

  const since = latest?.sanity_updated_at
    ? new Date(latest.sanity_updated_at).toISOString()
    : "1970-01-01T00:00:00Z"
  const docs = await sanityFetchWithToken<SanityExampleLead[]>(LEADS_QUERY, { since })
  const rows = docs.filter((doc) => doc.email).map(toRow)
  if (rows.length === 0) return 0

  const { error } = await admin.from("analyse_leads").upsert(rows, { onConflict: "id" })
  if (error) throw new Error(error.message)
  return rows.length
}

export async function syncAnalyseLeads(admin: SupabaseClient): Promise<AnalyseLeadsSyncResult> {
  try {
    const synced = await Promise.race([
      runSync(admin),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Tidsavbrudd mot Sanity")), SYNC_TIMEOUT_MS)
      ),
    ])
    return { ok: true, synced }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("syncAnalyseLeads", message)
    return { ok: false, error: message }
  }
}
