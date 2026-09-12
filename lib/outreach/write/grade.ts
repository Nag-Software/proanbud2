// Sensoren: en billig modell som svarer på ett spørsmål — ville Casper sendt
// denne uredigert?
//
// Sensoren BLOKKERER ikke alene. Den gir en karakter og en begrunnelse som
// vises i godkjenningsflaten, og den mater omskrivingen. Lint er dommeren;
// sensoren er den som sier hva som er galt med tonen.
//
// Merk: autopilot på steg 1 basert på sensoren er bevisst utsatt til Caspers
// første ~150–200 avgjørelser finnes som kalibreringssett (planens punkt 4).

import { asArray, asRecord, asString, structuredCall, type TokenUsage } from "@/lib/llm/structured"

export type GradeReport = {
  /** 1–5. 5 = «denne hadde jeg sendt som den er». */
  score: number
  spesifisitet: number
  tone: number
  cta: number
  begrunnelse: string
  forslag: string[]
  usage: TokenUsage | null
}

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["score", "spesifisitet", "tone", "cta", "begrunnelse", "forslag"],
  properties: {
    score: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description: "Ville Casper sendt denne uredigert? 5 = ja, 1 = aldri.",
    },
    spesifisitet: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description: "Kunne denne e-posten vært sendt til et hvilket som helst annet firma? Da er den 1.",
    },
    tone: { type: "integer", minimum: 1, maximum: 5, description: "Byggeplass, ikke SaaS." },
    cta: { type: "integer", minimum: 1, maximum: 5, description: "Lavterskel spørsmål, ikke møtebooking." },
    begrunnelse: { type: "string", description: "Én til to setninger." },
    forslag: {
      type: "array",
      items: { type: "string" },
      description: "Konkrete endringer. Tom liste hvis den er god nok.",
    },
  },
}

const SYSTEM = `Du er en streng, erfaren norsk B2B-selger som leser kalde e-poster og sier om de er verdt å sende.

Du vurderer e-poster skrevet på vegne av Casper Nag, som selger Proanbud til håndverksbedrifter. Han skriver kort, konkret og uten selgerspråk, som en som har stått på en byggeplass.

Slik dømmer du:
- Spesifisitet 5 krever at e-posten bare gir mening for akkurat DETTE firmaet. Kunne den vært sendt til hvem som helst i samme bransje, er den 1 eller 2.
- Tone 5 er rolig og konkret. Trekk hardt for salgsspråk, superlativer og «vi hjelper bedrifter med å».
- CTA 5 er ett spørsmål som kan besvares med én setning. Møtebooking og «vil du vite mer?» er 1.
- Score er helhetsdommen, ikke gjennomsnittet.

Vær streng. Den vanligste feilen er en e-post som er teknisk korrekt og fullstendig glemmelig.`

export type GradeInput = {
  subject: string
  body: string
  step: number
  /** Kroken utkastet skulle bygge på, med sitatet. */
  hookText: string | null
  hookQuote: string | null
  companyName: string
}

function gradeModel(): string {
  return process.env.SALG_GRADE_MODEL || process.env.OPENAI_MODEL || "gpt-5.2-mini"
}

export async function gradeMessage(input: GradeInput): Promise<GradeReport> {
  const user = [
    `Firma: ${input.companyName}`,
    `Dette er melding nummer ${input.step} i sekvensen.`,
    input.hookText ? `Observasjonen e-posten skulle bygge på: ${input.hookText}` : null,
    input.hookQuote ? `Sitatet fra deres nettside: «${input.hookQuote}»` : null,
    "",
    `Emne: ${input.subject}`,
    "",
    input.body,
  ]
    .filter((line) => line !== null)
    .join("\n")

  const result = await structuredCall(
    {
      model: gradeModel(),
      schemaName: "sensor_dom",
      schema: SCHEMA,
      system: SYSTEM,
      user,
      maxOutputTokens: 600,
      timeoutMs: 30000,
      effort: "low",
    },
    (value) => {
      const root = asRecord(value)
      const clamp = (raw: unknown) => {
        const number = typeof raw === "number" ? Math.round(raw) : 3
        return Math.max(1, Math.min(5, number))
      }
      return {
        score: clamp(root.score),
        spesifisitet: clamp(root.spesifisitet),
        tone: clamp(root.tone),
        cta: clamp(root.cta),
        begrunnelse: asString(root.begrunnelse),
        forslag: asArray(root.forslag).map((item) => asString(item)).filter(Boolean).slice(0, 5),
      }
    },
  )

  // Feiler sensoren, stopper vi ikke utkastet — da går det bare til Casper
  // uten karakter. Lint har allerede sagt sitt.
  if (!result.ok) {
    return {
      score: 3,
      spesifisitet: 3,
      tone: 3,
      cta: 3,
      begrunnelse: `Sensoren svarte ikke (${result.error}). Ikke vurdert.`,
      forslag: [],
      usage: result.usage,
    }
  }

  return { ...result.data, usage: result.usage }
}

/** Under denne karakteren er utkastet verdt en omskriving. */
export const GRADE_REWRITE_THRESHOLD = 4
