// Lint: den blokkerende kvalitetssjekken i kode.
//
// Sensoren (grade.ts) er en smaksdommer. Lint er ikke det — den håndhever
// regler som ikke er en smakssak: ordgrense, forbudte ord, at hvert tall har
// dekning, at prisen stemmer med lib/billing/plans.ts, og at e-posten faktisk
// spør om noe. Bryter et utkast lint, sendes det aldri, uansett hvor pent det
// er skrevet.

import { MODULE_PRICING, PLAN_PRICING } from "@/lib/billing/plans"
import { BANNED_WORDS, findBannedClaims, findBannedWords, verifiedFacts } from "@/lib/outreach/facts"
import { numbersIn } from "@/lib/outreach/research/ground"
import type { Hook } from "@/lib/outreach/research/synthesize"

export type LintSeverity = "blokkerende" | "advarsel"

export type LintIssue = {
  rule: string
  severity: LintSeverity
  message: string
}

export type LintReport = {
  ok: boolean
  issues: LintIssue[]
  word_count: number
  /** Kort tilbakemelding til omskrivingen. */
  feedback: string
}

/** Maks ord i brødteksten, uten signatur og bunntekst. */
export const WORD_LIMITS: Record<number, number> = { 1: 120, 2: 60, 3: 60 }

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u

const LINK = /\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:no|com|io|app)\/\S*/gi

/** Ord som signaliserer at vi snakker om regnskapsintegrasjon. */
const INTEGRATION_WORDS = /\b(tripletex|fiken|poweroffice|regnskapsintegrasjon|integrasjon(en|er)?)\b/i

/**
 * Klipper bort signaturen, så ordgrensen måler det Casper faktisk har skrevet
 * og ikke navnet sitt.
 */
export function bodyWithoutSignature(body: string): string {
  const index = body.indexOf("Casper Nag")
  return (index === -1 ? body : body.slice(0, index)).trim()
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[a-zæøåA-ZÆØÅ0-9]/.test(word)).length
}

/** Alle tall vi lovlig kan bruke: fra faktaarket, prislisten og dossieret. */
export function allowedNumbers(input: { hooks?: Hook[]; dossierText?: string }): Set<string> {
  const allowed = new Set<string>()

  const add = (text: string) => {
    for (const number of numbersIn(text)) allowed.add(number)
  }

  for (const fact of verifiedFacts()) add(fact.text)
  for (const plan of Object.values(PLAN_PRICING)) {
    for (const interval of Object.values(plan)) {
      allowed.add(String(interval.monthlyNok))
      allowed.add(String(interval.yearlyTotalNok))
    }
  }
  for (const price of Object.values(MODULE_PRICING)) allowed.add(String(price))

  for (const hook of input.hooks ?? []) {
    add(hook.text)
    add(hook.quote)
  }
  if (input.dossierText) add(input.dossierText)

  // Årstall er ikke en påstand om produktet. Små tall er derimot IKKE fritatt:
  // «sparer 7 timer i uka» er nettopp den typen påstand faktabrannmuren finnes
  // for, og den skal stoppes selv om tallet er lite.
  const year = new Date().getFullYear()
  for (let offset = -30; offset <= 1; offset++) allowed.add(String(year + offset))

  return allowed
}

/** Kjerneordene i kroken — de som må gå igjen i første setning. */
function hookKeywords(hook: Hook | null): string[] {
  if (!hook) return []
  const stop = new Set([
    "som",
    "med",
    "for",
    "har",
    "kan",
    "det",
    "den",
    "deres",
    "dere",
    "vi",
    "og",
    "til",
    "på",
    "av",
    "i",
    "er",
    "en",
    "et",
    "fra",
    "om",
    "at",
  ])
  return hook.text
    .toLowerCase()
    .split(/[^a-zæøå0-9]+/)
    .filter((word) => word.length >= 5 && !stop.has(word))
    .slice(0, 6)
}

function firstSentence(text: string): string {
  const body = text.replace(/^hei[,!.\s]*/i, "").trim()
  const match = body.match(/^[^.?!\n]+[.?!]?/)
  return (match?.[0] ?? body).trim()
}

export type LintInput = {
  subject: string
  body: string
  step: number
  hook: Hook | null
  /** Dossierets tekst — tall herfra har dekning. */
  dossierText?: string
  /** Steg 1 skal aldri ha lenke (best leveringsdyktighet). */
  allowLink?: boolean
}

export function lintMessage(input: LintInput): LintReport {
  const issues: LintIssue[] = []
  const body = bodyWithoutSignature(input.body)
  const full = `${input.subject}\n${body}`
  const wordCount = countWords(body)

  const block = (rule: string, message: string) =>
    issues.push({ rule, severity: "blokkerende", message })
  const warn = (rule: string, message: string) =>
    issues.push({ rule, severity: "advarsel", message })

  // ── Lengde ────────────────────────────────────────────────────────────────
  const limit = WORD_LIMITS[input.step] ?? 120
  if (wordCount > limit) {
    block("lengde", `${wordCount} ord i steg ${input.step}, grensen er ${limit}`)
  }
  if (wordCount < 25) {
    block("lengde", `Bare ${wordCount} ord — for lite til å si noe`)
  }

  // ── Faktabrannmuren ───────────────────────────────────────────────────────
  for (const why of findBannedClaims(full)) block("forbudt_paastand", why)
  for (const word of findBannedWords(full)) {
    block("forbudt_ord", `Ordet «${word}» er ikke lov (${BANNED_WORDS.length} på lista)`)
  }

  // ── Tone ──────────────────────────────────────────────────────────────────
  if (EMOJI.test(full)) block("emoji", "Ingen emojier")
  if (/!/.test(body)) block("utropstegn", "Ingen utropstegn")
  if (/\bkjære\b/i.test(body)) warn("tone", "«Kjære» er ikke Caspers stemme")

  // ── Lenker ────────────────────────────────────────────────────────────────
  const links = body.match(LINK) ?? []
  if (!input.allowLink && links.length > 0) {
    block("lenke", `Steg ${input.step} skal ikke ha lenke (${links[0]})`)
  } else if (links.length > 1) {
    block("lenke", `Maks én lenke, fant ${links.length}`)
  }

  // ── Kroken må stå i første setning ────────────────────────────────────────
  const keywords = hookKeywords(input.hook)
  if (keywords.length > 0) {
    const opening = firstSentence(body).toLowerCase()
    if (!keywords.some((keyword) => opening.includes(keyword))) {
      block(
        "krok_mangler",
        `Første setning nevner ikke kroken (${keywords.slice(0, 3).join(", ")})`,
      )
    }
  }

  // ── Alle tall må ha dekning ───────────────────────────────────────────────
  // Sifre inne i en lenke er ikke en påstand — sporingstokenet vårt inneholder
  // tall, og det skal ikke stoppe et ellers godt utkast.
  const allowed = allowedNumbers({ hooks: input.hook ? [input.hook] : [], dossierText: input.dossierText })
  const withoutLinks = full.replace(LINK, " ")
  for (const number of numbersIn(withoutLinks)) {
    if (!allowed.has(number)) {
      block("tall_uten_dekning", `Tallet ${number} står verken i faktaarket eller i dossieret`)
    }
  }

  // ── Pris + integrasjon må ikke villede ────────────────────────────────────
  // «Fra 189 kr» sammen med «faktura rett til Fiken» er villedende: på Mini er
  // integrasjoner et tillegg. Nevnes begge, må Proff-prisen eller modulprisen
  // stå der også.
  const mentionsPrice = /\b\d+\s*(kr|kroner)\b/i.test(body)
  if (mentionsPrice && INTEGRATION_WORDS.test(body)) {
    const proffPrices = [
      String(PLAN_PRICING.proff.month.monthlyNok),
      String(PLAN_PRICING.proff.year.monthlyNok),
    ]
    const modulePrice = String(MODULE_PRICING.integrasjoner)
    const numbers = numbersIn(body)
    const covered = [...proffPrices, modulePrice].some((price) => numbers.includes(price))
    if (!covered) {
      block(
        "pris_villedende",
        `Pris nevnt sammen med integrasjon uten Proff-pris (${proffPrices[1]} kr) eller modulpris (${modulePrice} kr)`,
      )
    }
  }

  // ── E-posten må spørre om noe ─────────────────────────────────────────────
  if (!/\?\s*$/.test(body.replace(/\s+$/, ""))) {
    block("mangler_sporsmal", "Siste setning er ikke et spørsmål")
  }

  // ── Emnefeltet ────────────────────────────────────────────────────────────
  const subjectWords = countWords(input.subject)
  if (subjectWords === 0) block("emne", "Emnefeltet er tomt")
  else if (subjectWords > 7) warn("emne", `${subjectWords} ord i emnet — hold det på 2–5`)
  if (/^(re|sv|fwd|vs):/i.test(input.subject) && input.step === 1) {
    block("emne", "Steg 1 skal ikke starte med Re:")
  }

  const blocking = issues.filter((issue) => issue.severity === "blokkerende")
  return {
    ok: blocking.length === 0,
    issues,
    word_count: wordCount,
    feedback: blocking.map((issue) => `- ${issue.message}`).join("\n"),
  }
}
