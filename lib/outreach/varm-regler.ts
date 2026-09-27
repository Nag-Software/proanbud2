// Reglene for den varme oppfølgingen — rene funksjoner uten database, så de
// kan testes (varm.ts drar inn server-only via feilloggen).
//
// Den varme sekvensen er for dem som selv laget et eksempeltilbud på
// proanbud.no og krysset av for at vi kunne følge opp. Den er kortere enn den
// kalde, og den har et annet utgangspunkt: vi trenger ingen krok fra
// nettsiden deres — vi vet hva de ba om.
//
//   steg 1  dagen etter analysen   godkjennes av Casper
//   steg 2  +4 dager etter steg 1  siste e-post, følger godkjenningsmodusen
//   +3 dager uten svar             sekvensen avsluttes, og det blir en telefon

import { domainFromWebsite, emailDomainOf, FREEMAIL_DOMAINS, isDirectoryDomain } from "@/lib/outreach/gates"
import type { TaskType } from "@/lib/outreach/oppgaver"
import type { RegistrationStage } from "@/lib/outreach/registrering"
import { bodyWithoutSignature, countWords, lintMessage, type LintIssue, type LintReport } from "@/lib/outreach/write/lint"

export const WARM_MAX_STEP = 2

/** Steg 1 skrives dagen etter analysen — ikke samme dag som eksempeltilbudet kom. */
export const WARM_FIRST_STEP_DELAY_HOURS = 20

/** Dager fra steg 1 er sendt til steg 2 går. */
export const WARM_STEP_2_OFFSET_DAYS = 4

/** Dager etter siste e-post før sekvensen lukkes og blir en oppgave. */
export const WARM_CLOSE_AFTER_DAYS = 3

/** Ordgrenser før signaturen. Strammere enn den kalde: de vet hvem vi er. */
export const WARM_WORD_LIMITS: Record<number, number> = { 1: 90, 2: 60 }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// ── Analysen ────────────────────────────────────────────────────────────────

/** Det vi vet om analysen, slik den står i analyse_leads. */
export type AnalyseFacts = {
  id: string
  email: string
  companyName: string | null
  website: string | null
  location: string | null
  services: string[]
  /** Faget tilbudet ble laget for, slik markedssiden navnga det. */
  trade: string | null
  detectedTrade: string | null
  jobTitle: string | null
  /** Sum eks. mva i hele kroner. */
  offerTotal: number | null
  submittedAt: string | null
  consentAt: string | null
  consentText: string | null
}

/** Kolonnene i analyse_leads som AnalyseLeadRecord leses fra. */
export const ANALYSE_FACT_COLUMNS =
  "id, email, website, domain, company_name, location, services, trade, detected_trade, job_title, offer_total, submitted_at, follow_up_consent, follow_up_consent_at, follow_up_consent_text"

export type AnalyseLeadRecord = {
  id: string
  email: string
  website: string | null
  domain: string | null
  company_name: string | null
  location: string | null
  services: string[] | null
  trade: string | null
  detected_trade: string | null
  job_title: string | null
  offer_total: number | null
  submitted_at: string | null
  follow_up_consent?: boolean | null
  follow_up_consent_at?: string | null
  follow_up_consent_text?: string | null
}

export function analyseFactsFrom(row: AnalyseLeadRecord): AnalyseFacts {
  return {
    id: row.id,
    email: row.email.trim().toLowerCase(),
    companyName: row.company_name?.trim() || null,
    website: row.website?.trim() || null,
    location: row.location?.trim() || null,
    services: (row.services ?? []).filter(Boolean),
    trade: row.trade?.trim() || null,
    detectedTrade: row.detected_trade?.trim() || null,
    jobTitle: row.job_title?.trim() || null,
    offerTotal: typeof row.offer_total === "number" ? row.offer_total : null,
    submittedAt: row.submitted_at,
    consentAt: row.follow_up_consent ? row.follow_up_consent_at ?? row.submitted_at : null,
    consentText: row.follow_up_consent ? row.follow_up_consent_text ?? null : null,
  }
}

/**
 * Firmadomenet til analysen. Nettsiden først, så e-postdomenet — men aldri
 * Gmail o.l. Før dette ble «gmail.com» brukt som domene for manuelle analyser,
 * og da kunne en analyse bli koblet til et hvilket som helst gmail-firma.
 */
export function analyseDomain(row: { domain: string | null; website: string | null; email: string }): string | null {
  const fromSite =
    row.domain?.trim().toLowerCase().replace(/^www\./, "") || domainFromWebsite(row.website)
  if (fromSite && !FREEMAIL_DOMAINS.has(fromSite) && !isDirectoryDomain(fromSite)) return fromSite
  const fromEmail = emailDomainOf(row.email)
  return fromEmail && !FREEMAIL_DOMAINS.has(fromEmail) ? fromEmail : null
}

/** «45 200» — med vanlig mellomrom, så modellen og lint leser det likt. */
export function formatNok(amount: number): string {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(amount).replace(/\s/g, " ")
}

/** «24. september», norsk tid. */
export function formatNorwegianDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", timeZone: "Europe/Oslo" }).format(date)
}

/**
 * Analysen som tekst — til skriveren, og til lint som «dossieret»: tall som
 * står her (summen, datoen, mengder i jobben) har dekning.
 */
export function analyseFactsText(facts: AnalyseFacts): string {
  const name = facts.companyName || facts.website || "firmaet"
  return [
    `Firma: ${name}${facts.location ? ` (${facts.location})` : ""}`,
    facts.submittedAt ? `Laget eksempeltilbudet: ${formatNorwegianDate(facts.submittedAt)}` : null,
    facts.jobTitle ? `Jobben i eksempeltilbudet: ${facts.jobTitle}` : null,
    facts.offerTotal !== null ? `Sum i eksempeltilbudet: ${formatNok(facts.offerTotal)} kr eks. mva` : null,
    facts.trade || facts.detectedTrade ? `Fag: ${facts.trade || facts.detectedTrade}` : null,
    facts.services.length > 0 ? `Tjenester de nevner på nettsiden: ${facts.services.slice(0, 8).join(", ")}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

// ── Broen ───────────────────────────────────────────────────────────────────

export type BridgeState = {
  submitted_at: string | null
  synced_at?: string | null
  bridged_at?: string | null
  bridged_submitted_at?: string | null
}

function timeOf(iso: string | null | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(value) ? Number.NaN : value
}

/**
 * Skal broen behandle raden? Aldri behandlet, eller endret siden sist.
 * synced_at og bridged_at settes begge av appen, så de sammenlignes med samme
 * klokke — Sanitys _updatedAt gjør ikke det.
 */
export function analyseNeedsBridge(row: BridgeState): boolean {
  if (!row.bridged_at) return true
  const synced = timeOf(row.synced_at)
  const bridged = timeOf(row.bridged_at)
  return !Number.isNaN(synced) && !Number.isNaN(bridged) && synced > bridged
}

/**
 * Er dette en ny analyse, eller bare flere opplysninger om en vi har sett?
 * Samme e-post og domene gir samme dokument i Sanity; en ny kjøring gir ny
 * submitted_at. Bare en ny kjøring skal stemple leadet varmt og lage oppgave.
 */
export function isNewAnalysisEvent(row: BridgeState): boolean {
  if (!row.bridged_submitted_at) return true
  const submitted = timeOf(row.submitted_at)
  const seen = timeOf(row.bridged_submitted_at)
  return !Number.isNaN(submitted) && (Number.isNaN(seen) || submitted > seen)
}

/** Den seneste av to tidspunkter — «sist aktiv» skal aldri gå bakover. */
export function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = timeOf(a)
  const tb = timeOf(b)
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : (b as string)
  if (Number.isNaN(tb)) return a as string
  return ta >= tb ? (a as string) : (b as string)
}

/** Frist for oppgaven: dagen etter analysen, og aldri tilbake i tid. */
export function analysisTaskDueAt(submittedAt: string | null, now: Date): Date {
  const submitted = timeOf(submittedAt)
  if (Number.isNaN(submitted)) return now
  return new Date(Math.max(now.getTime(), submitted + DAY_MS))
}

/** Krysset de av for oppfølging? */
export function consentGiven(row: { follow_up_consent?: boolean | null }): boolean {
  return row.follow_up_consent === true
}

// ── Tidspunkter ─────────────────────────────────────────────────────────────

/** Når steg 1 tidligst skal skrives: dagen etter analysen, og aldri før nå. */
export function firstWarmStepAt(submittedAt: string | null, now: Date): Date {
  const submitted = submittedAt ? Date.parse(submittedAt) : Number.NaN
  if (Number.isNaN(submitted)) return now
  return new Date(Math.max(now.getTime(), submitted + WARM_FIRST_STEP_DELAY_HOURS * HOUR_MS))
}

/**
 * Hva skjer etter at et varmt steg er sendt?
 *
 * Etter siste steg lukkes ikke sekvensen med én gang. Den står åpen i tre
 * dager, så et svar rekker å stoppe den — ellers ville «ring dem»-oppgaven
 * blokkert oppgaven svaret skal lage (én åpen oppgave per lead).
 */
export function afterWarmSend(step: number, sentAt: Date): { nextAt: Date; closing: boolean } {
  if (step < WARM_MAX_STEP) {
    return { nextAt: new Date(sentAt.getTime() + WARM_STEP_2_OFFSET_DAYS * DAY_MS), closing: false }
  }
  return { nextAt: new Date(sentAt.getTime() + WARM_CLOSE_AFTER_DAYS * DAY_MS), closing: true }
}

// ── Oppgaven ────────────────────────────────────────────────────────────────

export type AnalysisTask = { type: TaskType; title: string; note: string }

/**
 * Oppgaven for en analyse uten automatisk oppfølging — eller når den
 * automatiske ikke kom i mål. Telefon hvis vi har nummeret; en ekte samtale
 * med noen som nettopp ba om et tilbud er det beste vi kan gjøre.
 */
export function analysisTask(input: {
  facts: AnalyseFacts
  phone: string | null
  stage: RegistrationStage
  consent: boolean
}): AnalysisTask {
  // Uten telefon og uten samtykke er e-post til adressen de oppga utelukket —
  // skjemaet lovet det. Da er oppgaven å finne en annen vei inn.
  const type: TaskType = input.phone ? "ring" : input.consent ? "epost" : "annet"
  const title =
    input.stage === "konto"
      ? "Startet registreringen uten å fullføre — ta kontakt"
      : "Kjørte analysen — følg opp eksempeltilbudet"

  const note = [
    input.facts.jobTitle ? `Jobb: ${input.facts.jobTitle}` : null,
    input.facts.offerTotal !== null ? `${formatNok(input.facts.offerTotal)} kr eks. mva` : null,
    input.facts.submittedAt ? `analysert ${formatNorwegianDate(input.facts.submittedAt)}` : null,
    input.consent ? null : "sa ikke ja til e-postoppfølging",
  ]
    .filter(Boolean)
    .join(" · ")

  return { type, title, note }
}

// ── Kvalitetssjekken ────────────────────────────────────────────────────────

/** «Hei,» og første setning. */
function firstSentence(text: string): string {
  const body = text.replace(/^hei[,!.\s]*/i, "").trim()
  const match = body.match(/^[^.?!\n]+[.?!]?/)
  return (match?.[0] ?? body).trim()
}

/** Ord fra jobben som kan stå i første setning i stedet for «eksempeltilbudet». */
function jobKeywords(jobTitle: string | null): string[] {
  return (jobTitle ?? "")
    .toLowerCase()
    .split(/[^a-zæøå0-9]+/)
    .filter((word) => word.length >= 5)
    .slice(0, 6)
}

const REFERS_TO_OFFER = /eksempel|analyse|tilbud/i

/** «KI», «KI-en», «KI-generert» — aldri i utadrettet tekst. */
const MENTIONS_AI = /\bKI(-[a-zæøå]+)?\b/

/**
 * Lint for varm post: de samme harde reglene som den kalde (faktabrannmuren,
 * tall med dekning, tone, ett spørsmål), pluss tre av sine egne:
 *   - første setning viser til eksempeltilbudet de laget
 *   - strammere ordgrense
 *   - aldri «KI»
 * Steg 1 har ingen lenke; steg 2 kan ha én.
 */
export function lintWarmMessage(input: {
  subject: string
  body: string
  step: number
  facts: AnalyseFacts
}): LintReport {
  const base = lintMessage({
    subject: input.subject,
    body: input.body,
    step: input.step,
    hook: null,
    dossierText: analyseFactsText(input.facts),
    allowLink: input.step >= 2,
  })

  const issues: LintIssue[] = [...base.issues]
  const block = (rule: string, message: string) => issues.push({ rule, severity: "blokkerende", message })

  const body = bodyWithoutSignature(input.body)
  const opening = firstSentence(body).toLowerCase()
  const keywords = jobKeywords(input.facts.jobTitle)
  if (!REFERS_TO_OFFER.test(opening) && !keywords.some((keyword) => opening.includes(keyword))) {
    block("viser_ikke_til_tilbudet", "Første setning viser ikke til eksempeltilbudet de laget")
  }

  const limit = WARM_WORD_LIMITS[input.step]
  const words = countWords(body)
  const alreadyTooLong = issues.some((issue) => issue.rule === "lengde" && issue.severity === "blokkerende")
  if (limit && words > limit && !alreadyTooLong) {
    block("lengde", `${words} ord i varm oppfølging steg ${input.step}, grensen er ${limit}`)
  }

  if (MENTIONS_AI.test(`${input.subject}\n${body}`)) {
    block("ki", "Ikke skriv «KI» — si hva det gjør")
  }

  const blocking = issues.filter((issue) => issue.severity === "blokkerende")
  return {
    ok: blocking.length === 0,
    issues,
    word_count: base.word_count,
    feedback: blocking.map((issue) => `- ${issue.message}`).join("\n"),
  }
}
