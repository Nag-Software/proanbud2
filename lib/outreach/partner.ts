// Partnersegmentet: regnskapskontorer.
//
// Den vanlige måten å finne regnskapskontorer på er et NACE-søk. Problemet er
// at det gir alle kontorer, og de fleste har ingen håndverkere blant kundene.
//
// Vi har en bedre kilde, og vi har den allerede: Brønnøysund-rollen REGN sier
// hvem som fører regnskapet for hvert eneste firma vi har researchet. Aggregert
// over håndverkersegmentet får vi en liste over kontorer som BEVISELIG har
// håndverkere som kunder — sortert etter hvor mange. Det er en helt annen
// mållist enn et bransjesøk, fordi vinkelen («kundene deres slipper å punche
// tilbud fra Word») faktisk treffer noe de kjenner igjen.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchBrregEnhet } from "@/lib/outreach/brreg"
import {
  classifyContactEmail,
  collectGateReasons,
  contactPolicyFor,
  domainFromWebsite,
} from "@/lib/outreach/gates"

/** Kjedene. De har egne systemer og egne innkjøpsprosesser — ikke målgruppen. */
const CHAINS = [
  "azets",
  "accountor",
  "bdo",
  "ey ",
  "deloitte",
  "kpmg",
  "pwc",
  "sparebank",
  "vismа",
  "visma",
  "økonomipartner norge",
  "amesto",
]

export type AccountantLead = {
  orgnr: string
  name: string
  /** Hvor mange av våre håndverkerprospekter de fører regnskap for. */
  clients: number
  /** Navnene, til ringebriefen. Aldri i e-postteksten. */
  clientNames: string[]
  alreadyProspect: boolean
  isChain: boolean
}

function isChain(name: string): boolean {
  const lower = name.toLowerCase()
  return CHAINS.some((chain) => lower.includes(chain))
}

/**
 * Aggregerer REGN-rollen over prospektene vi allerede har researchet.
 *
 * Krever ingen nye oppslag mot Brreg — dataene er samlet inn som en bieffekt
 * av vanlig research.
 */
export async function discoverAccountants(options: { minClients?: number } = {}): Promise<
  AccountantLead[]
> {
  const minClients = options.minClients ?? 2

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("prospects")
      .select("name, accountant_orgnr, accountant_name")
      .not("accountant_orgnr", "is", null)
      .eq("segment", "handverker")
      .limit(5000)

    if (error || !data) return []

    const grouped = new Map<string, { name: string; clients: string[] }>()
    for (const row of data as Array<{
      name: string
      accountant_orgnr: string
      accountant_name: string | null
    }>) {
      const current = grouped.get(row.accountant_orgnr) ?? {
        name: row.accountant_name || row.accountant_orgnr,
        clients: [],
      }
      if (row.accountant_name && current.name === row.accountant_orgnr) {
        current.name = row.accountant_name
      }
      current.clients.push(row.name)
      grouped.set(row.accountant_orgnr, current)
    }

    const candidates = [...grouped.entries()].filter(
      ([, value]) => value.clients.length >= minClients,
    )
    if (candidates.length === 0) return []

    // Hvilke har vi allerede som prospekt?
    const { data: existing } = await admin
      .from("prospects")
      .select("org_number")
      .in(
        "org_number",
        candidates.map(([orgnr]) => orgnr),
      )
    const known = new Set(
      ((existing ?? []) as Array<{ org_number: string | null }>)
        .map((row) => row.org_number)
        .filter((value): value is string => Boolean(value)),
    )

    return candidates
      .map(([orgnr, value]) => ({
        orgnr,
        name: value.name,
        clients: value.clients.length,
        clientNames: value.clients.slice(0, 10),
        alreadyProspect: known.has(orgnr),
        isChain: isChain(value.name),
      }))
      .sort((a, b) => b.clients - a.clients)
  } catch (error) {
    void logServerError({
      message: "Kunne ikke aggregere regnskapsførere",
      level: "warning",
      source: "worker",
      error,
    })
    return []
  }
}

export type ImportSummary = {
  considered: number
  imported: number
  skipped: number
  reasons: Record<string, number>
}

/**
 * Melder de beste kontorene inn som prospekter i partnersegmentet.
 *
 * Hvert av dem går gjennom nøyaktig de samme portene som en håndverker — et
 * regnskapskontor er ikke unntatt markedsføringsloven fordi det er en partner.
 */
export async function importAccountants(options: {
  limit?: number
  minClients?: number
}): Promise<ImportSummary> {
  const summary: ImportSummary = { considered: 0, imported: 0, skipped: 0, reasons: {} }
  const admin = createAdminClient()

  const skip = (reason: string) => {
    summary.skipped += 1
    summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1
  }

  const candidates = (await discoverAccountants({ minClients: options.minClients }))
    .filter((candidate) => !candidate.alreadyProspect)
    .slice(0, options.limit ?? 20)

  for (const candidate of candidates) {
    summary.considered += 1

    if (candidate.isChain) {
      skip("kjede")
      continue
    }

    const enhet = await fetchBrregEnhet(candidate.orgnr)
    if (!enhet) {
      skip("ikke_i_brreg")
      continue
    }

    const email = enhet.epostadresse?.trim().toLowerCase() || null
    const website = enhet.hjemmeside || null
    const domain = domainFromWebsite(website) || null

    const emailClass = email
      ? classifyContactEmail(email, { companyName: enhet.navn, companyDomain: domain })
      : null

    const gateReasons = collectGateReasons({
      segment: "regnskapspartner",
      orgForm: enhet.organisasjonsform?.kode ?? null,
      konkurs: Boolean(enhet.konkurs || enhet.underAvvikling),
      employeeCount: enhet.antallAnsatte ?? null,
      emailClass,
      hasEmail: Boolean(email),
    })
    const policy = contactPolicyFor(gateReasons)

    if (policy === "blokkert" || policy === "utenfor_icp") {
      skip(gateReasons[0] ?? policy)
      continue
    }

    const { error } = await admin.from("prospects").insert({
      org_number: candidate.orgnr,
      name: enhet.navn,
      segment: "regnskapspartner",
      trade: "regnskap",
      source: "brreg",
      status: "ny",
      pipeline_state: policy === "epost_ok" ? "kilde" : "kun_telefon",
      org_form: enhet.organisasjonsform?.kode ?? null,
      employee_count: enhet.antallAnsatte ?? null,
      vat_registered: enhet.registrertIMvaregisteret ?? null,
      founded_on: enhet.stiftelsesdato ?? null,
      website,
      domain,
      email,
      email_source: email ? "brreg" : null,
      email_kind: emailClass,
      phone: enhet.telefon || enhet.mobil || null,
      city: enhet.forretningsadresse?.poststed ?? null,
      kommune: enhet.forretningsadresse?.kommune ?? null,
      kommune_number: enhet.forretningsadresse?.kommunenummer ?? null,
      nace_code: enhet.naeringskode1?.kode ?? null,
      nace_description: enhet.naeringskode1?.beskrivelse ?? null,
      contact_policy: policy,
      gate_reasons: gateReasons,
      brreg_checked_at: new Date().toISOString(),
      // Hvor mange av våre prospekter de fører regnskap for — ringebriefen.
      notes: `Fører regnskap for ${candidate.clients} av prospektene våre: ${candidate.clientNames.join(", ")}`,
    })

    if (error) {
      // 23505 = org.nr finnes allerede. Ikke en feil, bare allerede gjort.
      skip(error.code === "23505" ? "finnes_allerede" : "insert_feilet")
      continue
    }

    summary.imported += 1
  }

  return summary
}
