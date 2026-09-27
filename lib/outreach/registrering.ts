// Har de allerede registrert seg?
//
// Den varme oppfølgingen skal stoppe i det øyeblikket noen oppretter konto —
// da er det onboardingen som snakker med dem, ikke selgeren. Tre spor, fra
// sikkert til løst:
//
//   1. e-posten tilhører en bruker med firma           → «firma»
//   2. et firma har nettsiden eller e-posten på domenet → «firma»
//   3. e-posten har en konto, men ikke noe firma ennå  → «konto»
//
// Det tredje sporet er det viktigste å fange: de begynte på registreringen og
// stoppet. Det er ikke et lead som skal ha e-post nummer to — det er en
// telefon verdt.
//
// Signup-flyten sender ikke med sporingstokenet, så e-post og domene er det
// vi har.

import { reconcileProspectStatus } from "@/lib/selger/billing-transition"
import { domainFromWebsite, emailDomainOf, FREEMAIL_DOMAINS, isDirectoryDomain } from "@/lib/outreach/gates"
import type { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

export type RegistrationStage = "ingen" | "konto" | "firma"

export type Registration = {
  stage: RegistrationStage
  companyId: string | null
  /** company_billing.status for firmaet, hvis det finnes. */
  billingStatus: string | null
}

export const NOT_REGISTERED: Registration = { stage: "ingen", companyId: null, billingStatus: null }

/** ilike uten jokertegn: «ola_n@» skal ikke treffe «olaxn@». */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Er firmaet på dette domenet? Nettsiden eller e-postdomenet må være likt —
 * ikke bare inneholde det («tak.no» skal ikke treffe «mintak.no»).
 */
export function companyMatchesDomain(
  domain: string,
  company: { website: string | null; email: string | null },
): boolean {
  const wanted = domain.trim().toLowerCase().replace(/^www\./, "")
  if (!wanted || FREEMAIL_DOMAINS.has(wanted) || isDirectoryDomain(wanted)) return false
  const website = domainFromWebsite(company.website)
  const emailDomain = company.email ? emailDomainOf(company.email) : null
  return website === wanted || emailDomain === wanted
}

/**
 * Hvilke av adressene har en konto i auth? auth.users er ikke eksponert via
 * PostgREST, og GoTrue har ikke oppslag på e-post — så vi blar. Plattformen
 * har få nok brukere til at det er billig, og vi stopper så snart alle er funnet.
 */
export async function fetchAuthEmails(admin: AdminClient, emails: Iterable<string>): Promise<Set<string>> {
  const wanted = new Set([...emails].map((email) => email.trim().toLowerCase()).filter(Boolean))
  const found = new Set<string>()
  if (wanted.size === 0) return found

  const perPage = 1000
  for (let page = 1; page <= 10 && found.size < wanted.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) break
    for (const user of data.users) {
      const email = user.email?.toLowerCase()
      if (email && wanted.has(email)) found.add(email)
    }
    if (data.users.length < perPage) break
  }
  return found
}

async function billingStatusFor(admin: AdminClient, companyId: string): Promise<string | null> {
  const { data } = await admin
    .from("company_billing")
    .select("status")
    .eq("company_id", companyId)
    .maybeSingle<{ status: string | null }>()
  return data?.status ?? null
}

/**
 * Slår opp om e-posten eller domenet allerede er en kunde, en prøvebruker
 * eller en halvferdig registrering.
 *
 * `authEmails` kan sendes inn ferdig hentet når mange adresser sjekkes i én
 * kjøring (broen), så vi ikke blar gjennom brukerlisten én gang per rad.
 */
export async function findRegistration(
  admin: AdminClient,
  input: { email: string | null; domain: string | null },
  options: { authEmails?: Set<string> } = {},
): Promise<Registration> {
  const email = input.email?.trim().toLowerCase() || null
  const domain = input.domain?.trim().toLowerCase() || null

  try {
    // 1) En bruker med firma.
    if (email) {
      const { data } = await admin
        .from("users")
        .select("company_id")
        .ilike("email", escapeLike(email))
        .not("company_id", "is", null)
        .limit(1)
      const companyId = ((data ?? [])[0] as { company_id: string } | undefined)?.company_id ?? null
      if (companyId) {
        return { stage: "firma", companyId, billingStatus: await billingStatusFor(admin, companyId) }
      }
    }

    // 2) Et firma på samme domene. Aldri Gmail o.l. — da ville alle med en
    //    gmail-adresse «vært registrert».
    if (domain && !FREEMAIL_DOMAINS.has(domain) && !isDirectoryDomain(domain)) {
      const pattern = escapeLike(domain)
      const [byWebsite, byEmail] = await Promise.all([
        admin.from("companies").select("id, website, email").ilike("website", `%${pattern}%`).limit(10),
        admin.from("companies").select("id, website, email").ilike("email", `%@${pattern}`).limit(10),
      ])
      const candidates = [...(byWebsite.data ?? []), ...(byEmail.data ?? [])] as Array<{
        id: string
        website: string | null
        email: string | null
      }>
      const company = candidates.find((candidate) => companyMatchesDomain(domain, candidate))
      if (company) {
        return { stage: "firma", companyId: company.id, billingStatus: await billingStatusFor(admin, company.id) }
      }
    }

    // 3) En konto uten firma: registreringen ble ikke fullført.
    if (email) {
      const authEmails = options.authEmails ?? (await fetchAuthEmails(admin, [email]))
      if (authEmails.has(email)) return { stage: "konto", companyId: null, billingStatus: null }
    }
  } catch {
    // Et oppslag som feiler, skal ikke stoppe noe. Vi faller tilbake på
    // «ikke registrert», og sjekken kjøres på nytt rett før hver sending.
  }

  return NOT_REGISTERED
}

/**
 * Kobler prospektet til firmaet de registrerte, og lar statusen følge
 * betalingen (prøve → «Trial», betaler → «Vunnet»).
 *
 * Har firmaet allerede sitt eget prospekt — trial-broen rakk det først —
 * kobles ingenting, og det prospektet returneres. Det er den kanoniske dealen.
 */
export async function linkProspectToCompany(
  admin: AdminClient,
  prospect: { id: string; status: string; matched_company_id: string | null },
  registration: Registration,
): Promise<{ prospectId: string; linked: boolean }> {
  const companyId = registration.companyId
  if (!companyId) return { prospectId: prospect.id, linked: false }
  if (prospect.matched_company_id === companyId) return { prospectId: prospect.id, linked: false }

  const { data: existing } = await admin
    .from("prospects")
    .select("id")
    .eq("matched_company_id", companyId)
    .maybeSingle<{ id: string }>()
  if (existing && existing.id !== prospect.id) return { prospectId: existing.id, linked: false }

  // Allerede koblet til et annet firma? Da er det ikke vårt å flytte.
  if (prospect.matched_company_id) return { prospectId: prospect.id, linked: false }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    matched_company_id: companyId,
    is_existing_customer: true,
    pipeline_state: "overlevert",
    updated_at: now,
  }
  const transition = reconcileProspectStatus(prospect.status, registration.billingStatus ?? "")
  if (transition) {
    update.status = transition.status
    update.stage_entered_at = now
  }

  const { error } = await admin.from("prospects").update(update).eq("id", prospect.id)
  if (error?.code === "23505") {
    // Trial-broen koblet firmaet til et annet prospekt i mellomtiden.
    const { data: winner } = await admin
      .from("prospects")
      .select("id")
      .eq("matched_company_id", companyId)
      .maybeSingle<{ id: string }>()
    return { prospectId: winner?.id ?? prospect.id, linked: false }
  }
  return { prospectId: prospect.id, linked: !error }
}
