// Kjør portene på nytt for prospekter: hent fersk enhet + roller fra
// Brønnøysund, klassifiser e-postadressen og lagre samlet kontaktpolicy.
//
// Brukes av (1) «Sjekk porter»-knappen i innboksen, (2) importen rett etter
// innsetting, og (3) send-ruten når et prospekt aldri er sjekket. Endrer ALDRI
// status eller sletter noe — bare fakta og dommen om hvordan firmaet kan
// kontaktes. Et lead Casper allerede snakker med påvirkes ikke av dommen.

import type { createAdminClient } from "@/lib/supabase/admin"
import { fetchBrregEnhet, fetchBrregRoller } from "@/lib/outreach/brreg"
import {
  classifyContactEmail,
  collectGateReasons,
  contactPolicyFor,
  domainFromWebsite,
  emailDomainOf,
  FREEMAIL_DOMAINS,
  type ContactPolicy,
  type EmailClass,
  type GateReason,
} from "@/lib/outreach/gates"
import { resolveTrade } from "@/lib/outreach/segments"
import { isOptedOut } from "@/lib/outreach/send"

type AdminClient = ReturnType<typeof createAdminClient>

/** Kolonnene portene trenger. Lest med select("*") slik at koden tåler at db/90
 *  ennå ikke er kjørt (da mangler bare de nye feltene). */
export type GateProspect = {
  id: string
  org_number: string | null
  name: string
  email: string | null
  website: string | null
  employee_count: number | null
  nace_code: string | null
  nace_description: string | null
  is_existing_customer: boolean | null
  matched_company_id: string | null
  source?: string | null
  segment?: string | null
  org_form?: string | null
  domain?: string | null
  trade?: string | null
  email_source?: string | null
}

/** Hvor en eldre adresse (uten email_source) mest sannsynlig kom fra. */
function defaultEmailSource(source: string | null | undefined): string {
  if (source === "brreg") return "brreg"
  if (source === "signup") return "signup"
  if (source === "analyse") return "analyse"
  return "manuell"
}

export type RegateOutcome = {
  id: string
  policy: ContactPolicy
  reasons: GateReason[]
  emailKind: EmailClass | null
  orgForm: string | null
  employeeCount: number | null
  optedOut: boolean
  /** Kolonnene som lagres på prospektet (brukes av regateProspect). */
  update: Record<string, unknown>
}

/** Sjekk ett prospekt og lagre resultatet. */
export async function regateProspect(
  admin: AdminClient,
  prospect: GateProspect,
  options: { fetchBrreg?: boolean } = {},
): Promise<RegateOutcome> {
  const outcome = await evaluateProspectGates(admin, prospect, options)
  const { error } = await admin.from("prospects").update(outcome.update).eq("id", prospect.id)
  if (error) throw new Error(`Kunne ikke lagre portdom: ${error.message}`)
  return outcome
}

/** Regn ut portdommen med fersk Brønnøysund-data — uten å skrive noe. Send-ruten
 *  bruker denne rett før en manuell kaldsending, så dommen alltid er fersk. */
export async function evaluateProspectGates(
  admin: AdminClient,
  prospect: GateProspect,
  options: { fetchBrreg?: boolean } = {},
): Promise<RegateOutcome> {
  const fetchBrreg = options.fetchBrreg ?? true
  const orgNumber = prospect.org_number?.trim() || null

  const [enhet, roller] =
    fetchBrreg && orgNumber
      ? await Promise.all([fetchBrregEnhet(orgNumber), fetchBrregRoller(orgNumber)])
      : [null, { personNames: [], dagligLeder: null, regnskapsforerOrgnr: null }]

  const orgForm = enhet?.organisasjonsform?.kode?.trim().toUpperCase() || prospect.org_form || null
  const employeeCount =
    typeof enhet?.antallAnsatte === "number" ? enhet.antallAnsatte : prospect.employee_count
  const konkurs = Boolean(
    enhet?.konkurs || enhet?.underAvvikling || enhet?.underTvangsavviklingEllerTvangsopplosning,
  )

  const website = prospect.website || (enhet?.hjemmeside ? `https://${enhet.hjemmeside}` : null)
  const email = prospect.email?.trim().toLowerCase() || null
  const emailDomain = email ? emailDomainOf(email) : null
  const companyDomain =
    domainFromWebsite(website) ??
    prospect.domain ??
    (emailDomain && !FREEMAIL_DOMAINS.has(emailDomain) ? emailDomain : null)

  const emailKind = email
    ? classifyContactEmail(email, {
        companyName: prospect.name,
        companyDomain: domainFromWebsite(website),
        personNames: roller.personNames,
      })
    : null

  const optedOut = await isOptedOut(admin, { email, orgNumber, domain: companyDomain })

  const reasons = collectGateReasons({
    segment: prospect.segment,
    orgForm,
    konkurs,
    employeeCount,
    isExistingCustomer: Boolean(prospect.is_existing_customer || prospect.matched_company_id),
    optedOut,
    emailClass: emailKind,
    hasEmail: Boolean(email),
  })
  // Uten org.nr (manuelle leads) kan vi ikke vite organisasjonsformen — da er
  // dommen «ukjent» uansett hva adressen er.
  const policy = contactPolicyFor(reasons)

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    org_form: orgForm,
    domain: companyDomain,
    trade:
      prospect.trade ||
      resolveTrade({
        naceCode: enhet?.naeringskode1?.kode ?? prospect.nace_code,
        naceDescription: enhet?.naeringskode1?.beskrivelse ?? prospect.nace_description,
      }),
    email_kind: emailKind,
    email_source: email ? prospect.email_source ?? defaultEmailSource(prospect.source) : null,
    contact_policy: policy,
    gate_reasons: reasons,
    updated_at: now,
  }
  if (enhet) {
    update.brreg_checked_at = now
    update.founded_on = /^\d{4}-\d{2}-\d{2}$/.test(enhet.stiftelsesdato ?? "") ? enhet.stiftelsesdato : null
    update.vat_registered = typeof enhet.registrertIMvaregisteret === "boolean" ? enhet.registrertIMvaregisteret : null
    update.in_group = typeof enhet.erIKonsern === "boolean" ? enhet.erIKonsern : null
    if (typeof enhet.antallAnsatte === "number") update.employee_count = enhet.antallAnsatte
  }

  return {
    id: prospect.id,
    policy,
    reasons,
    emailKind,
    orgForm,
    employeeCount: employeeCount ?? null,
    optedOut,
    update,
  }
}

export type RegateSummary = {
  checked: number
  errors: number
  byPolicy: Record<ContactPolicy, number>
}

/** Sjekk mange prospekter med begrenset samtidighet (Brønnøysund er et
 *  offentlig API — vi holder oss høflige). */
export async function regateProspects(
  admin: AdminClient,
  prospects: GateProspect[],
  options: { concurrency?: number } = {},
): Promise<RegateSummary> {
  const summary: RegateSummary = {
    checked: 0,
    errors: 0,
    byPolicy: { ukjent: 0, epost_ok: 0, kun_telefon: 0, utenfor_icp: 0, blokkert: 0 },
  }
  const queue = [...prospects]
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 8))

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const outcome = await regateProspect(admin, next)
          summary.checked += 1
          summary.byPolicy[outcome.policy] += 1
        } catch (error) {
          summary.errors += 1
          console.error("[outreach/regate] feilet for", next.id, error)
        }
      }
    }),
  )
  return summary
}
