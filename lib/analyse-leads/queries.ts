import type { SupabaseClient } from "@supabase/supabase-js"

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { syncAnalyseLeads } from "@/lib/analyse-leads/sync"
import type {
  AnalyseLeadRow,
  AnalyseLeadsSyncResult,
  OnboardingMatch,
  OnboardingStage,
} from "@/lib/analyse-leads/types"

/**
 * Leser `analyse_leads` (etter en inkrementell synk fra Sanity) og kobler hvert
 * lead mot plattformen:
 *
 *   1. E-posten fra analysen → auth.users (konto) og users (firma). Signup-lenken
 *      etter eksempeltilbudet forhåndsutfyller e-posten, så dette er hovedsporet.
 *   2. Domenet fra analysen → companies.website, eller domenet i companies.email.
 *      Fanger dem som registrerte seg med en annen e-post.
 */

type AuthUserInfo = { created_at: string; last_sign_in_at: string | null }

type CompanyInfo = NonNullable<OnboardingMatch["company"]> & {
  website_domain: string | null
  email_domain: string | null
}

// E-postdomener som aldri sier noe om hvilket firma det er.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.no",
  "outlook.com",
  "outlook.no",
  "live.com",
  "live.no",
  "yahoo.com",
  "yahoo.no",
  "icloud.com",
  "me.com",
  "online.no",
  "getmail.no",
  "lyse.net",
  "broadpark.no",
  "altibox.no",
])

/** «https://www.Firma.no/om-oss» → «firma.no». */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
    return url.hostname.replace(/^www\./, "") || null
  } catch {
    return null
  }
}

function emailDomain(email: string | null | undefined): string | null {
  const domain = email?.split("@")[1]?.trim().toLowerCase()
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null
  return domain
}

function latestTimestamp(values: (string | null | undefined)[]): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (value && (!latest || value > latest)) latest = value
  }
  return latest
}

function stageFor(
  company: OnboardingMatch["company"],
  hasAccount: boolean
): OnboardingStage {
  if (company) {
    switch (company.billing_status) {
      case "active":
      case "past_due":
        return "paying"
      case "trialing":
        return "trial"
      case "canceled":
      case "unpaid":
        return "churned"
      default:
        return "company"
    }
  }
  return hasAccount ? "account" : "none"
}

/**
 * auth.users er ikke eksponert via PostgREST, og GoTrue har ikke oppslag på
 * e-post — så vi blar gjennom brukerlisten. Plattformen har få nok brukere til
 * at det er billig; taket hindrer at det løper løpsk.
 */
async function fetchAuthUsersByEmail(
  admin: SupabaseClient,
  emails: Set<string>
): Promise<Map<string, AuthUserInfo>> {
  const found = new Map<string, AuthUserInfo>()
  const perPage = 1000
  for (let page = 1; page <= 10 && found.size < emails.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error("fetchAuthUsersByEmail", error.message)
      break
    }
    for (const user of data.users) {
      const email = user.email?.toLowerCase()
      if (email && emails.has(email)) {
        found.set(email, {
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at ?? null,
        })
      }
    }
    if (data.users.length < perPage) break
  }
  return found
}

async function fetchCompanies(admin: SupabaseClient): Promise<CompanyInfo[]> {
  const { data, error } = await admin
    .from("companies")
    .select(
      "id, name, website, email, created_at, users(last_seen_at), offers(count), company_billing(status, plan_key, trial_ends_at)"
    )
  if (error) {
    console.error("analyse-leads fetchCompanies", error.message)
    return []
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const users = (row.users as { last_seen_at: string | null }[] | null) ?? []
    const offers = row.offers as { count: number }[] | null
    const billing = row.company_billing as
      | { status: string | null; plan_key: string | null; trial_ends_at: string | null }
      | { status: string | null; plan_key: string | null; trial_ends_at: string | null }[]
      | null
    const billingRow = Array.isArray(billing) ? billing[0] : billing

    return {
      id: String(row.id),
      name: String(row.name),
      created_at: String(row.created_at),
      plan_key: billingRow?.plan_key ?? null,
      billing_status: billingRow?.status ?? null,
      trial_ends_at: billingRow?.trial_ends_at ?? null,
      offer_count: offers?.[0]?.count ?? 0,
      last_seen_at: latestTimestamp(users.map((u) => u.last_seen_at)),
      website_domain: normalizeDomain(row.website as string | null),
      email_domain: emailDomain(row.email as string | null),
    }
  })
}

export async function fetchAnalyseLeads(): Promise<{
  leads: AnalyseLeadRow[]
  sync: AnalyseLeadsSyncResult
}> {
  const admin = createAdminClient()
  const sync = await syncAnalyseLeads(admin)

  const { data: rows, error } = await admin
    .from("analyse_leads")
    .select(
      "id, email, website, domain, status, manual, company_name, location, phone, company_email, has_logo, services, detected_trade, trade_confidence, asked_questions, trade, job_title, offer_total, email_sent, utm, referral_code, submitted_at, completed_at"
    )
    .order("submitted_at", { ascending: false, nullsFirst: false })

  if (error) {
    await logServerError({
      message: "Kunne ikke hente analyserte firmaer",
      error,
      source: "server",
      route: "fetchAnalyseLeads",
    })
    return { leads: [], sync }
  }

  const leads = rows ?? []
  const emails = new Set(leads.map((lead) => lead.email.toLowerCase()))

  const [authUsers, companies, usersRes] = await Promise.all([
    fetchAuthUsersByEmail(admin, emails),
    fetchCompanies(admin),
    emails.size
      ? admin.from("users").select("email, company_id").in("email", [...emails])
      : Promise.resolve({ data: [] as { email: string; company_id: string | null }[] }),
  ])

  const companyById = new Map(companies.map((c) => [c.id, c]))
  const companyIdByEmail = new Map<string, string>()
  for (const user of usersRes.data ?? []) {
    if (user.email && user.company_id) {
      companyIdByEmail.set(user.email.toLowerCase(), user.company_id)
    }
  }

  const result: AnalyseLeadRow[] = leads.map((lead) => {
    const email = lead.email.toLowerCase()
    const auth = authUsers.get(email)

    let matchedBy: OnboardingMatch["matched_by"] = null
    let company: CompanyInfo | undefined

    const companyId = companyIdByEmail.get(email)
    if (companyId) {
      company = companyById.get(companyId)
      if (company) matchedBy = "email"
    }
    if (!company && lead.domain) {
      const domain = normalizeDomain(lead.domain)
      company = companies.find(
        (c) => domain && (c.website_domain === domain || c.email_domain === domain)
      )
      if (company) matchedBy = "domain"
    }
    if (!company && auth) matchedBy = "email"

    const matchedCompany = company
      ? {
          id: company.id,
          name: company.name,
          created_at: company.created_at,
          plan_key: company.plan_key,
          billing_status: company.billing_status,
          trial_ends_at: company.trial_ends_at,
          offer_count: company.offer_count,
          last_seen_at: company.last_seen_at,
        }
      : null

    return {
      ...lead,
      services: lead.services ?? [],
      trade_confidence: lead.trade_confidence === null ? null : Number(lead.trade_confidence),
      onboarding: {
        stage: stageFor(matchedCompany, Boolean(auth)),
        matched_by: matchedBy,
        account_created_at: auth?.created_at ?? null,
        last_sign_in_at: auth?.last_sign_in_at ?? null,
        company: matchedCompany,
      },
    }
  })

  return { leads: result, sync }
}
