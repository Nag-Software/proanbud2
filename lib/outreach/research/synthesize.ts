// LLM-syntesen: ett strukturert kall som TREKKER UT og FORMULERER.
//
// Arbeidsdelingen er hele poenget:
//   modellen  →  leser sidene og foreslår kroker, smerter og en oppsummering
//   koden     →  validerer hvert sitat mot sideteksten, teller signaler,
//                regner ut fit_score og bestemmer verdict
//
// Modellen kan altså ikke «gi» et prospekt en A. Den kan bare peke på noe, og
// så avgjør koden om det den peker på faktisk står der.

import {
  asArray,
  asRecord,
  asString,
  defaultModel,
  structuredCall,
  type StructuredError,
  type TokenUsage,
} from "@/lib/llm/structured"
import { checkQuoteGrounding } from "@/lib/outreach/research/ground"
import { SIGNAL_LABELS, type Signal, type SignalKey } from "@/lib/outreach/research/extract"
import type { SegmentKey } from "@/lib/outreach/segments"

export const HOOK_TYPES = [
  "tjeneste",
  "prosjekt",
  "vekst",
  "rekruttering",
  "sertifisering",
  "kundetype",
  "omdomme",
  "verktoy",
] as const
export type HookType = (typeof HOOK_TYPES)[number]

export type Hook = {
  id: string
  type: HookType
  /** Caspers observasjon, formulert av modellen. */
  text: string
  /** Ordrett fra siden. Valideres i kode. */
  quote: string
  source_url: string
  grounded: boolean
  grounding_reason: string
}

export type Dossier = {
  fag: string
  kundetype: "privat" | "borettslag" | "naering" | "offentlig" | "ukjent"
  storrelse: string
  hooks: Hook[]
  pains: string[]
  disqualifiers: string[]
  best_angle: string
  summary: string
}

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["fag", "kundetype", "storrelse", "kroker", "smerter", "diskvalifiserere", "beste_vinkel", "oppsummering"],
  properties: {
    fag: { type: "string", description: "Hva firmaet faktisk gjør, med deres egne ord." },
    kundetype: {
      type: "string",
      enum: ["privat", "borettslag", "naering", "offentlig", "ukjent"],
    },
    storrelse: { type: "string", description: "Kort: antall ansatte og inntrykk av omfang." },
    kroker: {
      type: "array",
      description:
        "1-3 observasjoner som kunne stått i en e-post fra en som faktisk leste nettsiden. Hver MÅ ha et ordrett sitat.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "tekst", "sitat", "kilde_url"],
        properties: {
          type: { type: "string", enum: [...HOOK_TYPES] },
          tekst: { type: "string", description: "Observasjonen, én setning, på norsk." },
          sitat: {
            type: "string",
            description:
              "ORDRETT kopiert fra sideteksten du fikk. Minst 4 meningsbærende ord. Ikke omskriv, ikke rett opp skrivefeil.",
          },
          kilde_url: { type: "string" },
        },
      },
    },
    smerter: {
      type: "array",
      items: { type: "string" },
      description: "Konkrete problemer denne bedriften sannsynligvis har med tilbud og papirflyt.",
    },
    diskvalifiserere: {
      type: "array",
      items: { type: "string" },
      description: "Tegn på at de IKKE er i målgruppen (kjede, kun offentlige anbud, har allerede et system).",
    },
    beste_vinkel: { type: "string" },
    oppsummering: { type: "string", description: "3-4 setninger Casper kan lese på 10 sekunder." },
  },
}

function systemPrompt(): string {
  return `Du er research-assistent for en norsk B2B-selger. Du får hentet tekst fra et håndverksfirmas egen nettside, pluss offentlige data fra Brønnøysund.

Oppgaven din er å TREKKE UT det som står der, ikke å selge og ikke å gjette.

Ufravikelige regler:
- Hvert sitat i "sitat" skal være ORDRETT kopiert fra teksten du har fått. Kopier tegn for tegn, inkludert skrivefeil. Ikke oversett, ikke stram opp, ikke slå sammen to setninger.
- Et sitat som ikke finnes ordrett i teksten blir forkastet automatisk, og da står selgeren uten noe å skrive om. Det er bedre å levere én ekte krok enn tre pene.
- Finner du ikke noe konkret å henge en krok på, lever en tom liste. Tomt er et gyldig og nyttig svar.
- Ingen påstander om omsetning, resultat eller antall ansatte i krokene. De tallene er interne.
- Skriv på norsk bokmål.`
}

type SynthesizeInput = {
  segment: SegmentKey
  companyName: string
  orgNumber: string
  city: string | null
  naceDescription: string | null
  employeeCount: number | null
  /** Sammenslått sidetekst. Dette er også fasiten sitatene valideres mot. */
  pageText: string
  /** Kildelenker per side, så modellen kan oppgi riktig kilde_url. */
  pageUrls: string[]
  signals: Signal[]
  regnskapNote: string | null
  placesNote: string | null
}

function userPrompt(input: SynthesizeInput): string {
  const signalLines = input.signals
    .filter((signal) => signal.met)
    .map((signal) => `- ${SIGNAL_LABELS[signal.key]}: «${signal.evidence}»`)

  return [
    `Firma: ${input.companyName} (org.nr. ${input.orgNumber})`,
    input.city ? `Sted: ${input.city}` : null,
    input.naceDescription ? `Registrert bransje: ${input.naceDescription}` : null,
    typeof input.employeeCount === "number" ? `Ansatte: ${input.employeeCount}` : null,
    input.regnskapNote ? `Regnskap (internt, aldri i e-post): ${input.regnskapNote}` : null,
    input.placesNote ? `Google: ${input.placesNote}` : null,
    "",
    signalLines.length > 0 ? `Signaler koden allerede har funnet:\n${signalLines.join("\n")}` : null,
    "",
    `Kilder (bruk én av disse som kilde_url):\n${input.pageUrls.map((url) => `- ${url}`).join("\n")}`,
    "",
    "── Hentet sidetekst ──",
    input.pageText,
  ]
    .filter((line) => line !== null)
    .join("\n")
}

function parseDossier(value: unknown, pageUrls: string[]): Omit<Dossier, "hooks"> & {
  rawHooks: Array<{ type: HookType; text: string; quote: string; source_url: string }>
} {
  const root = asRecord(value)
  const kundetype = asString(root.kundetype, "ukjent")

  return {
    fag: asString(root.fag),
    kundetype: (["privat", "borettslag", "naering", "offentlig", "ukjent"].includes(kundetype)
      ? kundetype
      : "ukjent") as Dossier["kundetype"],
    storrelse: asString(root.storrelse),
    pains: asArray(root.smerter).map((item) => asString(item)).filter(Boolean).slice(0, 5),
    disqualifiers: asArray(root.diskvalifiserere)
      .map((item) => asString(item))
      .filter(Boolean)
      .slice(0, 5),
    best_angle: asString(root.beste_vinkel),
    summary: asString(root.oppsummering),
    rawHooks: asArray(root.kroker)
      .map((item) => {
        const hook = asRecord(item)
        const type = asString(hook.type) as HookType
        return {
          type: HOOK_TYPES.includes(type) ? type : ("tjeneste" as HookType),
          text: asString(hook.tekst),
          quote: asString(hook.sitat),
          source_url: asString(hook.kilde_url) || pageUrls[0] || "",
        }
      })
      .filter((hook) => hook.text && hook.quote)
      .slice(0, 3),
  }
}

export type SynthesizeOutput = {
  ok: true
  dossier: Dossier
  usage: TokenUsage
}

export async function synthesizeDossier(
  input: SynthesizeInput,
): Promise<SynthesizeOutput | StructuredError> {
  const result = await structuredCall(
    {
      model: process.env.SALG_RESEARCH_MODEL || defaultModel(),
      schemaName: "prospect_dossier",
      schema: SCHEMA,
      system: systemPrompt(),
      user: userPrompt(input),
      maxOutputTokens: 2000,
      timeoutMs: 60000,
    },
    (value) => parseDossier(value, input.pageUrls),
  )

  if (!result.ok) return result

  // Sitatvalidering i kode. Dette er stedet hallusinasjoner dør.
  const hooks: Hook[] = result.data.rawHooks.map((hook, index) => {
    const grounding = checkQuoteGrounding(hook.quote, input.pageText)
    return {
      id: `k${index + 1}`,
      type: hook.type,
      text: hook.text,
      quote: hook.quote,
      source_url: hook.source_url,
      grounded: grounding.grounded,
      grounding_reason: grounding.reason,
    }
  })

  return {
    ok: true,
    dossier: {
      fag: result.data.fag,
      kundetype: result.data.kundetype,
      storrelse: result.data.storrelse,
      hooks,
      pains: result.data.pains,
      disqualifiers: result.data.disqualifiers,
      best_angle: result.data.best_angle,
      summary: result.data.summary,
    },
    usage: result.usage,
  }
}

// ── Kvalifisering i kode ────────────────────────────────────────────────────

export type FitCriterion = {
  key: string
  label: string
  met: boolean
  evidence: string
  source_url: string | null
  /** Vekt i poengsummen. */
  weight: number
}

export type Fit = {
  criteria: FitCriterion[]
  /** 1–5. 5 = midt i blinken. */
  score: number
  tier: "A" | "B" | "C"
  points: number
  max_points: number
}

const SIGNAL_WEIGHTS: Partial<Record<SignalKey, number>> = {
  tilbudsskjema: 3,
  referanseprosjekter: 2,
  regnskapsverktoy: 2,
  rekruttering: 2,
  flerspraklig: 1,
  sentral_godkjenning: 1,
  flere_fag: 2,
  privatmarked: 1,
}

export type FitInput = {
  signals: Signal[]
  employeeCount: number | null
  /** Har vi en verifisert nettside i det hele tatt? */
  hasWebsite: boolean
  groundedHooks: number
  omsetningPerAnsatt: number | null
  vekst: number | null
}

/**
 * Deterministisk rubrikk. Poengene er Caspers egne kriterier, og de er de
 * samme for hvert prospekt — derfor kan A/B/C sammenlignes over tid.
 */
export function computeFit(input: FitInput): Fit {
  const criteria: FitCriterion[] = []

  for (const signal of input.signals) {
    const weight = SIGNAL_WEIGHTS[signal.key]
    if (!weight) continue
    criteria.push({
      key: signal.key,
      label: SIGNAL_LABELS[signal.key],
      met: signal.met,
      evidence: signal.evidence,
      source_url: signal.source_url,
      weight,
    })
  }

  const employees = input.employeeCount
  criteria.push({
    key: "ansatte",
    label: "5–20 ansatte",
    met: typeof employees === "number" && employees >= 5 && employees <= 20,
    evidence: typeof employees === "number" ? `${employees} ansatte` : "ukjent antall",
    source_url: null,
    weight: 3,
  })

  criteria.push({
    key: "nettside",
    label: "Verifisert nettside",
    met: input.hasWebsite,
    evidence: input.hasWebsite ? "nettsiden er verifisert" : "ingen verifisert nettside",
    source_url: null,
    weight: 2,
  })

  criteria.push({
    key: "vekst",
    label: "Vekst i driftsinntekter",
    met: typeof input.vekst === "number" && input.vekst > 0.05,
    evidence:
      typeof input.vekst === "number"
        ? `${input.vekst > 0 ? "+" : ""}${Math.round(input.vekst * 100)} % siste år`
        : "ingen regnskapstall",
    source_url: null,
    weight: 1,
  })

  const maxPoints = criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  const points = criteria.reduce(
    (sum, criterion) => sum + (criterion.met ? criterion.weight : 0),
    0,
  )
  const ratio = maxPoints > 0 ? points / maxPoints : 0

  // Uten en validert krok er det ingenting å skrive om, uansett poengsum.
  const score = input.groundedHooks === 0 ? 1 : Math.max(1, Math.min(5, Math.ceil(ratio * 5)))
  const tier: Fit["tier"] = score >= 4 ? "A" : score === 3 ? "B" : "C"

  return { criteria, score, tier, points, max_points: maxPoints }
}
