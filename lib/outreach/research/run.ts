// researchProspect: én jobb per prospekt.
//
// Rekkefølgen er valgt for å bruke minst mulig penger:
//   1. Porter først  — er det ingen lovlig e-postkanal, stopper vi FØR crawl
//                      og før LLM-kallet, og prospektet blir `kun_telefon`.
//   2. Gratis kilder — Brreg, roller og regnskap kjører parallelt.
//   3. Nettside      — verifiseres, så crawles forsiden + inntil 5 undersider.
//   4. Signaler      — deterministiske detektorer i kode.
//   5. LLM           — ett strukturert kall, bare hvis vi faktisk har tekst.
//   6. Dom           — koden validerer sitatene og regner ut fit_score.
//
// Funksjonen kaster aldri. En feilet research skal aldri velte en tick.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchBrregEnhet, fetchBrregRoller } from "@/lib/outreach/brreg"
import {
  classifyContactEmail,
  collectGateReasons,
  contactPolicyFor,
  domainFromWebsite,
  emailDomainOf,
  PHONE_ONLY_REASONS,
} from "@/lib/outreach/gates"
import { detectSignals, extractPage, pickSubpages, type ExtractedPage } from "@/lib/outreach/research/extract"
import { fetchPage } from "@/lib/outreach/research/fetch"
import { discoverWebsite } from "@/lib/outreach/research/discover"
import { fetchRegnskap, omsetningPerAnsatt, type Regnskap } from "@/lib/outreach/research/regnskap"
import { fetchPlaces, type PlacesResult } from "@/lib/outreach/research/places"
import { computeFit, synthesizeDossier, type Dossier, type Fit } from "@/lib/outreach/research/synthesize"
import { getSegment } from "@/lib/outreach/segments"
import type { ProspectRow } from "@/lib/outreach/types"

/** Maks sidetekst vi tar vare på, så en enkelt rad ikke sprenger tabellen. */
const MAX_PAGE_TEXT = 60_000
/** Maks tekst vi sender til modellen. Nok til bredde, lite nok til å være billig. */
const MAX_PROMPT_TEXT = 24_000
const MAX_SUBPAGES = 5

export type ResearchSource = {
  kind: "brreg" | "roller" | "regnskap" | "nettside" | "places" | "sok"
  url: string
  ok: boolean
  fetched_at: string
}

export type Verdict = "kvalifisert" | "diskvalifisert" | "for_tynn" | "kun_telefon"

export type ResearchOutcome = {
  ok: boolean
  prospect_id: string
  research_id: string | null
  verdict: Verdict
  pipeline_state: string
  reason: string | null
  cost_usd: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[kappet]`
}

/** Kort tilfeldig token til ?r= og pluss-adressen. Kollisjon fanges av unik indeks. */
function newTrackingToken(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
  let token = ""
  for (let i = 0; i < 10; i++) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return token
}

function regnskapNote(regnskap: Regnskap | null, employeeCount: number | null): string | null {
  if (!regnskap?.siste) return null
  const parts: string[] = []
  if (regnskap.siste.driftsinntekter !== null) {
    parts.push(
      `driftsinntekter ${Math.round(regnskap.siste.driftsinntekter / 1000)} tkr (${regnskap.siste.aar})`,
    )
  }
  if (regnskap.vekst !== null) {
    parts.push(`${regnskap.vekst > 0 ? "+" : ""}${Math.round(regnskap.vekst * 100)} % mot året før`)
  }
  const perAnsatt = omsetningPerAnsatt(regnskap, employeeCount)
  if (perAnsatt) parts.push(`${Math.round(perAnsatt / 1000)} tkr per ansatt`)
  return parts.length > 0 ? parts.join(", ") : null
}

function placesNote(places: PlacesResult | null): string | null {
  if (!places || places.rating === null) return null
  return `${places.rating} av 5 på ${places.review_count ?? 0} anmeldelser`
}

/** Henter forsiden og inntil fem undersider, sekvensielt mot samme vert. */
async function crawlSite(startUrl: string): Promise<ExtractedPage[]> {
  const front = await fetchPage(startUrl, 8000)
  if (!front) return []

  const frontPage = extractPage(front.html, front.url)
  const pages = [frontPage]

  for (const url of pickSubpages(frontPage.links, front.url, MAX_SUBPAGES)) {
    const page = await fetchPage(url, 6000)
    if (!page) continue
    pages.push(extractPage(page.html, page.url))
  }

  return pages
}

/**
 * Kjører research for ett prospekt og lagrer dossieret. Returnerer alltid et
 * resultat — feil havner i `reason` og på prospektet, ikke som en exception.
 */
export async function researchProspect(prospectId: string): Promise<ResearchOutcome> {
  const started = Date.now()
  const supabase = createAdminClient()
  const sources: ResearchSource[] = []

  const fail = async (reason: string, verdict: Verdict, state: string): Promise<ResearchOutcome> => {
    await supabase
      .from("prospects")
      .update({
        pipeline_state: state,
        research_error: reason,
        research_locked_at: null,
        researched_at: nowIso(),
      })
      .eq("id", prospectId)
    return {
      ok: false,
      prospect_id: prospectId,
      research_id: null,
      verdict,
      pipeline_state: state,
      reason,
      cost_usd: 0,
    }
  }

  try {
    const { data: prospect, error } = await supabase
      .from("prospects")
      .select("*")
      .eq("id", prospectId)
      .maybeSingle<ProspectRow>()

    if (error || !prospect) return fail("Fant ikke prospektet", "diskvalifisert", "diskvalifisert")

    // ── 1) Friske Brreg-data + porter, før vi bruker penger ──────────────────
    const orgNumber = prospect.org_number?.replace(/\D/g, "") || ""
    const [enhet, roller] = await Promise.all([
      orgNumber ? fetchBrregEnhet(orgNumber) : Promise.resolve(null),
      orgNumber
        ? fetchBrregRoller(orgNumber)
        : Promise.resolve({ personNames: [], dagligLeder: null, regnskapsforerOrgnr: null }),
    ])

    if (orgNumber) {
      sources.push({
        kind: "brreg",
        url: `https://data.brreg.no/enhetsregisteret/api/enheter/${orgNumber}`,
        ok: Boolean(enhet),
        fetched_at: nowIso(),
      })
      sources.push({
        kind: "roller",
        url: `https://data.brreg.no/enhetsregisteret/api/enheter/${orgNumber}/roller`,
        ok: roller.personNames.length > 0,
        fetched_at: nowIso(),
      })
    }

    const orgForm = enhet?.organisasjonsform?.kode || prospect.org_form || null
    const employeeCount = enhet?.antallAnsatte ?? prospect.employee_count ?? null
    const konkurs = Boolean(enhet?.konkurs || enhet?.underAvvikling)
    const email = prospect.email?.trim() || null
    const website = prospect.website || enhet?.hjemmeside || null
    const domain = prospect.domain || domainFromWebsite(website) || emailDomainOf(email || "")

    const emailClass = email
      ? classifyContactEmail(email, {
          companyName: prospect.name,
          companyDomain: domain,
          personNames: roller.personNames,
        })
      : null

    const gateReasons = collectGateReasons({
      segment: prospect.segment,
      orgForm,
      konkurs,
      employeeCount,
      isExistingCustomer: prospect.is_existing_customer,
      emailClass,
      hasEmail: Boolean(email),
    })
    const policy = contactPolicyFor(gateReasons)

    await supabase
      .from("prospects")
      .update({
        org_form: orgForm,
        employee_count: employeeCount,
        domain,
        email_kind: emailClass,
        gate_reasons: gateReasons,
        contact_policy: policy,
        brreg_checked_at: nowIso(),
        tracking_token: prospect.tracking_token ?? newTrackingToken(),
        // Rollen REGN. Aggregert over målgruppen blir dette mållista for
        // partnersegmentet (lib/outreach/partner.ts).
        accountant_orgnr: roller.regnskapsforerOrgnr,
      })
      .eq("id", prospectId)

    // Ingen lovlig e-postkanal → telefonlisten. Vi stopper før LLM-kostnaden.
    if (gateReasons.length > 0 && gateReasons.every((reason) => PHONE_ONLY_REASONS.has(reason))) {
      return fail("Ingen lovlig e-postadresse", "kun_telefon", "kun_telefon")
    }
    if (policy === "blokkert" || policy === "utenfor_icp") {
      await supabase
        .from("prospects")
        .update({ disqualify_reason: gateReasons[0] ?? policy })
        .eq("id", prospectId)
      return fail(`Porten stoppet prospektet: ${gateReasons[0] ?? policy}`, "diskvalifisert", "diskvalifisert")
    }

    // ── 2) Gratis kilder i parallell ─────────────────────────────────────────
    const [regnskap, discovery] = await Promise.all([
      orgNumber ? fetchRegnskap(orgNumber) : Promise.resolve(null),
      discoverWebsite({
        companyName: prospect.name,
        orgNumber,
        phone: prospect.phone,
        knownWebsite: website,
        kommune: prospect.kommune,
      }),
    ])

    if (regnskap) {
      sources.push({ kind: "regnskap", url: regnskap.source_url, ok: true, fetched_at: nowIso() })
    }
    if (discovery.searched && discovery.query) {
      sources.push({
        kind: "sok",
        url: `https://search.brave.com/search?q=${encodeURIComponent(discovery.query)}`,
        ok: Boolean(discovery.site),
        fetched_at: nowIso(),
      })
    }

    // ── 3) Crawl ─────────────────────────────────────────────────────────────
    const pages = discovery.site ? await crawlSite(discovery.site.url) : []
    for (const page of pages) {
      sources.push({ kind: "nettside", url: page.url, ok: true, fetched_at: nowIso() })
    }

    const places = await fetchPlaces({ companyName: prospect.name, city: prospect.city })
    if (places) {
      sources.push({ kind: "places", url: places.source_url, ok: true, fetched_at: nowIso() })
    }

    // Nettsiden er ofte en bedre e-postkilde enn Brreg.
    const siteEmail = pages.flatMap((page) => page.emails).find((candidate) => {
      const candidateClass = classifyContactEmail(candidate, {
        companyName: prospect.name,
        companyDomain: discovery.site?.host ?? domain,
        personNames: roller.personNames,
      })
      return candidateClass === "generisk_firmadomene"
    })
    if (siteEmail && (!email || emailClass !== "generisk_firmadomene")) {
      await supabase
        .from("prospects")
        .update({
          email: siteEmail,
          email_source: "nettside",
          email_kind: "generisk_firmadomene",
          contact_policy: "epost_ok",
          gate_reasons: gateReasons.filter((reason) => !PHONE_ONLY_REASONS.has(reason)),
        })
        .eq("id", prospectId)
    }

    if (discovery.site && discovery.site.url !== prospect.website) {
      await supabase
        .from("prospects")
        .update({ website: discovery.site.url, domain: discovery.site.host })
        .eq("id", prospectId)
    }

    const signals = detectSignals(pages)
    const pageText = truncate(
      pages.map((page) => `## ${page.title || page.url}\n${page.url}\n\n${page.text}`).join("\n\n"),
      MAX_PAGE_TEXT,
    )

    // ── 4) Uten tekst er det ingenting å personalisere på ────────────────────
    if (pages.length === 0 || pageText.trim().length < 400) {
      const fit = computeFit({
        signals,
        employeeCount,
        hasWebsite: false,
        groundedHooks: 0,
        omsetningPerAnsatt: omsetningPerAnsatt(regnskap, employeeCount),
        vekst: regnskap?.vekst ?? null,
      })
      const { data: row } = await supabase
        .from("prospect_research")
        .insert({
          prospect_id: prospectId,
          status: "ok",
          sources,
          facts: { brreg: { orgForm, employeeCount, konkurs }, regnskap, places },
          hooks: [],
          fit,
          verdict: "for_tynn",
          summary: "Ingen verifisert nettside med nok tekst. Ingen e-post skrives.",
          page_text: pageText || null,
          duration_ms: Date.now() - started,
        })
        .select("id")
        .single()

      await supabase
        .from("prospects")
        .update({
          pipeline_state: "for_tynn",
          research_id: row?.id ?? null,
          researched_at: nowIso(),
          research_locked_at: null,
          research_error: null,
          fit_score: fit.score,
          fit_tier: fit.tier,
        })
        .eq("id", prospectId)

      return {
        ok: true,
        prospect_id: prospectId,
        research_id: row?.id ?? null,
        verdict: "for_tynn",
        pipeline_state: "for_tynn",
        reason: "For tynt grunnlag",
        cost_usd: 0,
      }
    }

    // ── 5) Ett strukturert LLM-kall ──────────────────────────────────────────
    const segment = getSegment(prospect.segment)
    const synthesis = await synthesizeDossier({
      segment: segment.key,
      companyName: prospect.name,
      orgNumber,
      city: prospect.city,
      naceDescription: prospect.nace_description,
      employeeCount,
      pageText: truncate(pageText, MAX_PROMPT_TEXT),
      pageUrls: pages.map((page) => page.url),
      signals,
      regnskapNote: regnskapNote(regnskap, employeeCount),
      placesNote: placesNote(places),
    })

    if (!synthesis.ok) {
      await supabase.from("prospect_research").insert({
        prospect_id: prospectId,
        status: "feilet",
        sources,
        facts: { brreg: { orgForm, employeeCount, konkurs }, regnskap, places },
        verdict: "for_tynn",
        page_text: pageText,
        error: synthesis.error,
        model: synthesis.usage?.model ?? null,
        cost_usd: synthesis.usage?.cost_usd ?? null,
        duration_ms: Date.now() - started,
      })
      return fail(`Syntesen feilet: ${synthesis.error}`, "for_tynn", "venter_research")
    }

    // ── 6) Dommen faller i kode ──────────────────────────────────────────────
    const dossier: Dossier = synthesis.dossier
    const groundedHooks = dossier.hooks.filter((hook) => hook.grounded)
    const fit: Fit = computeFit({
      signals,
      employeeCount,
      hasWebsite: true,
      groundedHooks: groundedHooks.length,
      omsetningPerAnsatt: omsetningPerAnsatt(regnskap, employeeCount),
      vekst: regnskap?.vekst ?? null,
    })

    const verdict: Verdict =
      dossier.disqualifiers.length >= 2
        ? "diskvalifisert"
        : groundedHooks.length === 0
          ? "for_tynn"
          : "kvalifisert"

    const pipelineState =
      verdict === "kvalifisert" ? "kvalifisert" : verdict === "diskvalifisert" ? "diskvalifisert" : "for_tynn"

    const { data: row, error: insertError } = await supabase
      .from("prospect_research")
      .insert({
        prospect_id: prospectId,
        status: "ok",
        sources,
        facts: {
          brreg: { orgForm, employeeCount, konkurs, founded_on: enhet?.stiftelsesdato ?? null },
          regnskap,
          places,
          nettside: {
            url: discovery.site?.url ?? null,
            verified_by: discovery.site?.verified_by ?? null,
            signaler: signals.filter((signal) => signal.met),
          },
          dossier: {
            fag: dossier.fag,
            kundetype: dossier.kundetype,
            storrelse: dossier.storrelse,
          },
        },
        hooks: dossier.hooks,
        fit,
        pains: dossier.pains,
        disqualifiers: dossier.disqualifiers,
        best_angle: dossier.best_angle,
        summary: dossier.summary,
        verdict,
        page_text: pageText,
        model: synthesis.usage.model,
        tokens_in: synthesis.usage.tokens_in,
        tokens_out: synthesis.usage.tokens_out,
        cost_usd: synthesis.usage.cost_usd,
        duration_ms: Date.now() - started,
      })
      .select("id")
      .single()

    if (insertError) {
      return fail(`Kunne ikke lagre dossieret: ${insertError.message}`, "for_tynn", "venter_research")
    }

    await supabase
      .from("prospects")
      .update({
        pipeline_state: pipelineState,
        research_id: row.id,
        researched_at: nowIso(),
        research_locked_at: null,
        research_error: null,
        research_attempts: 0,
        fit_score: fit.score,
        fit_tier: fit.tier,
        trade: prospect.trade,
        disqualify_reason: verdict === "diskvalifisert" ? dossier.disqualifiers[0] ?? null : null,
      })
      .eq("id", prospectId)

    return {
      ok: true,
      prospect_id: prospectId,
      research_id: row.id,
      verdict,
      pipeline_state: pipelineState,
      reason: null,
      cost_usd: synthesis.usage.cost_usd,
    }
  } catch (error) {
    void logServerError({
      message: "Research av prospekt feilet",
      level: "error",
      source: "worker",
      error,
      context: { prospectId },
    })
    return fail(
      error instanceof Error ? error.message : "Ukjent feil under research",
      "for_tynn",
      "venter_research",
    )
  }
}
