// Faktaarket: det ENESTE maskinen får påstå om Proanbud i en salgs-e-post.
//
// Regelen er enkel: står det ikke her med verified: true, finnes det ikke for
// skrivemotoren. Priser og moduler leses rett fra lib/billing/plans.ts, så en
// prisendring aldri gir en e-post med gammel pris. Provisjon for partnere leses
// fra lib/affiliate/commission.ts.
//
// Uverifiserte påstander står her MED begrunnelse, så Casper kan bekrefte dem
// (flipp verified) i stedet for at de sniker seg inn via en prompt.

import {
  MODULE_PRICING,
  MODULES_INCLUDED_IN_PROFF,
  PLAN_PRICING,
  SEAT_PRICE_NOK,
  TRIAL_DAYS,
  INCLUDED_SEATS_BY_PLAN,
} from "@/lib/billing/plans"
import { COMMISSION_RATE } from "@/lib/affiliate/commission"

export type FactId =
  | "pris_mini"
  | "pris_proff"
  | "prove"
  | "ki_tilbud"
  | "egne_prisfiler"
  | "kunde_godkjenner"
  | "faktura_regnskap"
  | "integrasjon_pris"
  | "timeforing"
  | "hms_ks"
  | "brukere_proff"
  | "kalender"
  | "data_eu"
  | "partner_provisjon"
  | "ingen_binding"
  | "ks_polsk"
  | "handverker_ser_ikke_priser"
  | "support_responstid"
  | "gratis_opplaering"

export type Fact = {
  id: FactId
  text: string
  verified: boolean
  /** Hvor sannheten bor (kodefil eller hvem som bekreftet). */
  source: string
  /** Segmenter faktumet er relevant for. Mangler = alle. */
  segments?: Array<"handverker" | "regnskapspartner">
  /** Må stå sammen med disse faktaene når den brukes (hindrer villedende utelatelse). */
  requires?: FactId[]
}

const mini = PLAN_PRICING.mini
const proff = PLAN_PRICING.proff
const nok = (value: number) => new Intl.NumberFormat("nb-NO").format(value)

export const FACTS: Fact[] = [
  {
    id: "pris_mini",
    text: `Mini koster ${nok(mini.year.monthlyNok)} kr i måneden ved årlig betaling, ${nok(mini.month.monthlyNok)} kr ved månedlig.`,
    verified: true,
    source: "lib/billing/plans.ts PLAN_PRICING",
  },
  {
    id: "pris_proff",
    text: `Proff koster ${nok(proff.year.monthlyNok)} kr i måneden ved årlig betaling, ${nok(proff.month.monthlyNok)} kr ved månedlig, med ${INCLUDED_SEATS_BY_PLAN.proff} brukere inkludert.`,
    verified: true,
    source: "lib/billing/plans.ts PLAN_PRICING + INCLUDED_SEATS_BY_PLAN",
  },
  {
    id: "prove",
    text: `${TRIAL_DAYS} dager gratis prøve med alt inkludert, uten betalingskort.`,
    verified: true,
    source: "lib/billing/plans.ts TRIAL_DAYS + createTrialSubscription (kortfri, lib/billing/checkout.ts)",
  },
  {
    id: "ki_tilbud",
    text: "Du beskriver jobben med tekst eller bilde, og KI-en setter opp et komplett tilbud med linjer du kan redigere.",
    verified: true,
    source: "Kjerneflyten i /nytt-tilbud",
    segments: ["handverker"],
  },
  {
    id: "egne_prisfiler",
    text: "Kalkylen bygger på bedriftens egne prisfiler (Excel eller EFO/NELFO fra grossisten) og lagrede jobber, ikke gjettede priser.",
    verified: true,
    source: "Mine priser → Prisfiler (Excel + EFO/NELFO-import)",
    segments: ["handverker"],
  },
  {
    id: "kunde_godkjenner",
    text: "Kunden får tilbudet som en lenke og godkjenner på mobilen uten å lage konto.",
    verified: true,
    source: "/tilbudsvisning + digital aksept med e-postkode",
  },
  {
    id: "faktura_regnskap",
    text: "Fakturaen går fra prosjektet rett til Tripletex eller Fiken, uten at noe punches på nytt.",
    verified: true,
    source: "Casper bekreftet 2026-09-08 (proanbud-salg/CONTEXT.md §3); lib/regnskap/",
    // Mini-kunder betaler integrasjonen ekstra — nevnes pris og faktura sammen,
    // må det også stå hva integrasjonen koster.
    requires: ["integrasjon_pris"],
  },
  {
    id: "integrasjon_pris",
    text: `Tripletex- og Fiken-integrasjonen er inkludert i Proff, og koster ${nok(MODULE_PRICING.integrasjoner)} kr i måneden som tillegg på Mini.`,
    verified: MODULES_INCLUDED_IN_PROFF.includes("integrasjoner"),
    source: "lib/billing/plans.ts MODULE_PRICING + MODULES_INCLUDED_IN_PROFF",
  },
  {
    id: "timeforing",
    text: `Timeføring per prosjekt er inkludert i Proff, og koster ${nok(MODULE_PRICING.timeforing)} kr i måneden på Mini.`,
    verified: MODULES_INCLUDED_IN_PROFF.includes("timeforing"),
    source: "lib/billing/plans.ts MODULE_PRICING + MODULES_INCLUDED_IN_PROFF",
    segments: ["handverker"],
  },
  {
    id: "hms_ks",
    text: "Proff har HMS-håndbok, KS-sjekklister og avvikshåndtering.",
    verified: true,
    source: "lib/billing/plans.ts PROFF_INCLUDED_FEATURES",
    segments: ["handverker"],
  },
  {
    id: "brukere_proff",
    text: `Proff har ${INCLUDED_SEATS_BY_PLAN.proff} brukere inkludert, og hver ekstra bruker koster ${nok(SEAT_PRICE_NOK)} kr i måneden.`,
    verified: true,
    source: "lib/billing/plans.ts INCLUDED_SEATS_BY_PLAN + SEAT_PRICE_NOK",
  },
  {
    id: "kalender",
    text: "Kalender med synk mot Google og Outlook følger med på alle planer.",
    verified: true,
    source: "Kalender alle planer siden 2026-07-02 (PLAN_FEATURES)",
    segments: ["handverker"],
  },
  {
    id: "data_eu",
    text: "Dataene lagres i EU.",
    verified: true,
    source: "Supabase eu-west-1 + Vercel dub1 (hjelpesenter-fasiten)",
  },
  {
    id: "partner_provisjon",
    text: `Regnskapskontor som henviser, får kundens første månedspris som engangsbonus og ${Math.round(COMMISSION_RATE * 100)} % av abonnementet så lenge kunden er aktiv.`,
    verified: true,
    source: "lib/affiliate/commission.ts COMMISSION_RATE + firstMonthBonusNok",
    segments: ["regnskapspartner"],
  },
  // ── Ikke bekreftet — skrivemotoren ser ALDRI disse før Casper flipper verified.
  {
    id: "ingen_binding",
    text: "Ingen binding — månedlig abonnement kan sies opp når som helst.",
    verified: false,
    source: "Står i CONTEXT.md, men årlig betaling binder i ett år — bekreft ordlyden",
  },
  {
    id: "ks_polsk",
    text: "KS-sjekklistene finnes på norsk, engelsk og polsk.",
    verified: false,
    source: "Står i CONTEXT.md — ikke sjekket mot appen",
    segments: ["handverker"],
  },
  {
    id: "handverker_ser_ikke_priser",
    text: "Håndverkerne får appen uten å se priser, salg eller innstillinger.",
    verified: false,
    source: "Står i CONTEXT.md — sjekk mot rolletilgangen før bruk",
    segments: ["handverker"],
  },
  {
    id: "support_responstid",
    text: "Norsk support med under to timers responstid.",
    verified: false,
    source: "Står i CONTEXT.md — et løfte vi må kunne holde",
  },
  {
    id: "gratis_opplaering",
    text: "Gratis opplæring inkludert.",
    verified: false,
    source: "Står i CONTEXT.md — ikke bekreftet",
  },
]

export function verifiedFacts(segment?: "handverker" | "regnskapspartner"): Fact[] {
  return FACTS.filter(
    (fact) => fact.verified && (!segment || !fact.segments || fact.segments.includes(segment)),
  )
}

/**
 * Påstander som ALDRI skal i en salgs-e-post — feil, uverifisert eller
 * villedende (markedsføringsloven § 6–7 / § 25). Brukes av lint og i prompten.
 */
export const BANNED_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /5\s?200\s*\+?\s*tilbud/i, why: "«5200+ tilbud» er ikke sant" },
  { pattern: /\b50\s?%\s*(spart|mindre|admin)/i, why: "«50 % spart admin-tid» er ikke dokumentert" },
  { pattern: /\b30\s?%\s*(høyere|flere|bedre)/i, why: "«30 %»-tall er ikke dokumentert" },
  { pattern: /norske?\s+servere?/i, why: "Dataene lagres i EU, ikke på norske servere" },
  { pattern: /docusign/i, why: "DocuSign er ikke verifisert i appen" },
  { pattern: /sander\s+nag/i, why: "Nærstående — sitatet kan ikke brukes uten å opplyse om forholdet" },
  { pattern: /ole\s+kristiansen/i, why: "Sitatet er ikke verifisert" },
  { pattern: /ki-generert|generert av ki|skrevet av ki/i, why: "Aldri «KI-generert» i utadrettet tekst (Caspers preferanse)" },
]

/** Ord Casper aldri bruker (proanbud-salg/SKILL.md «Tone»). */
export const BANNED_WORDS = [
  "løsning",
  "løsninger",
  "synergi",
  "digitalisering",
  "effektivisering",
  "effektivisere",
  "sømløs",
  "sømløst",
  "revolusjoner",
  "banebrytende",
  "book et møte",
]

export function findBannedClaims(text: string): string[] {
  return BANNED_CLAIMS.filter((claim) => claim.pattern.test(text)).map((claim) => claim.why)
}

export function findBannedWords(text: string): string[] {
  const lower = text.toLowerCase()
  return BANNED_WORDS.filter((word) => new RegExp(`(^|[^a-zæøå])${word}([^a-zæøå]|$)`, "i").test(lower))
}

/** Faktaarket som prompt-tekst: bare verifiserte, med id-er skriveren kan vise til. */
export function factsForPrompt(segment: "handverker" | "regnskapspartner" = "handverker"): string {
  return verifiedFacts(segment)
    .map((fact) => {
      const needs = fact.requires?.length ? ` (må nevnes sammen med: ${fact.requires.join(", ")})` : ""
      return `- [${fact.id}] ${fact.text}${needs}`
    })
    .join("\n")
}
