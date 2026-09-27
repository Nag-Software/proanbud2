// KI-redigering av tilbud: prompt, skjema for svaret, og én reparasjonsrunde
// når modellen bommer på skjemaet. Ruta (app/api/offers/[id]/ai-edit) eier
// databasen, tilgangene og OpenAI-kallet; alt her er rent og testbart.
//
// Hvorfor en reparasjonsrunde: modellen skriver hele tilbudet på nytt, og ett
// eneste felt utenfor skjemaet veltet før hele forslaget med en 500-feil —
// målt til ~1 av 8 redigeringer med gpt-5.6-terra (f.eks. en fradragslinje med
// minusbeløp). Feilene er nesten alltid lokale, så modellen får se dem og rette.
import { z } from "zod"

import type { OfferLineItem } from "./types"

/** Tilbudets lagrede linjer slik modellen får se dem, med trygge standardverdier. */
export function normalizeExistingLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return []

  return input
    .map((row) => {
      const item = row as Partial<OfferLineItem>
      return {
        id: String(item.id || crypto.randomUUID()),
        subproject: String(item.subproject || "Generelt"),
        title: String(item.title || ""),
        description: String(item.description || ""),
        reasoning: item.reasoning ? String(item.reasoning) : undefined,
        quantity: Number(item.quantity || 0),
        unit: String(item.unit || "stk"),
        supplier: String(item.supplier || ""),
        nobb: item.nobb ? String(item.nobb) : undefined,
        supplierSku: item.supplierSku ? String(item.supplierSku) : undefined,
        supplierUrl: item.supplierUrl ? String(item.supplierUrl) : undefined,
        unitPriceNok: Number(item.unitPriceNok || 0),
        markupPercent: Number(item.markupPercent || 0),
        discountPercent: Number(item.discountPercent || 0),
        priceSource: item.priceSource,
        // Uten denne mistet fastprislinjer fra lagrede jobber timene sine ved
        // hver KI-endring: forslaget erstatter alle linjene i klienten.
        plannedHours: Number(item.plannedHours) > 0 ? Number(item.plannedHours) : undefined,
        incomeAccountCategory: item.incomeAccountCategory,
      }
    })
    .filter((item) => item.title.trim())
}

export const AI_EDIT_SYSTEM_PROMPT = [
  "Du redigerer norske håndverkertilbud.",
  "Gjør bare endringene brukeren uttrykkelig ber om.",
  "Returner hele tilbudet i gyldig JSON, uten markdown.",
  "Behold alle uendrede felt og linjer nøyaktig.",
  "Behold id på eksisterende linjer. Utelat id bare for nye linjer.",
  "Ikke finn på leverandør, artikkelnummer eller pris.",
  "For en ny linje uten eksplisitt pris, bruk unitPriceNok 0 og priceSource anslag.",
  "priceSource er bare prisfil, lagret-jobb eller anslag. Nye arbeidslinjer får ingen priceSource.",
  "Alt arbeid skal være egne linjer med unit time og quantity = antall timer — aldri m2, stk, lm eller RS for arbeid.",
  "Timepris for arbeid hentes fra timepriser; finn aldri på egne timepriser. Arbeid har markupPercent 0.",
  "Ingen tall er negative. Et fradrag («trekk fra», «kunden gjør det selv») gjøres ved å redusere antall eller timer på linja det gjelder, eller med discountPercent — aldri som en linje med minusbeløp.",
  "Slett aldri en linje med mindre brukeren tydelig ber om det.",
  "Beløp er ekskludert mva. Skriv kort og tydelig norsk.",
].join(" ")

export function buildAiEditUserMessage(input: {
  instruction: string
  currentOffer: { title: string; description: string; sourceSummary: string; lineItems: unknown[] }
  timepriser: unknown
}) {
  return JSON.stringify({
    instruction: input.instruction,
    currentOffer: input.currentOffer,
    timepriser: input.timepriser,
    requiredResponseShape: {
      summary: "kort oppsummering",
      title: "hele tittelen",
      description: "hele beskrivelsen",
      sourceSummary: "hele kundemeldingen",
      lineItems: "hele listen med tilbudslinjer",
    },
  })
}

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.string().max(max).optional()
  )

export const aiEditLineItemSchema = z.object({
  // Nye linjer kommer ofte med «id: null» i stedet for uten id.
  id: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  subproject: z.string().trim().min(1).max(120).default("Generelt"),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(2_000).default(""),
  reasoning: optionalText(2_000),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.string().trim().min(1).max(40).default("stk"),
  supplier: z.string().max(160).default(""),
  nobb: optionalText(100),
  supplierSku: optionalText(100),
  supplierUrl: z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.string().url().optional()
  ),
  unitPriceNok: z.number().min(0).max(1_000_000_000),
  markupPercent: z.number().min(0).max(100),
  discountPercent: z.number().min(0).max(100),
  // Metadata modellen gjerne finner på egne verdier til («timepris» på nye
  // arbeidslinjer). En ukjent verdi betyr bare «ukjent», og ruta faller
  // tilbake på linjas forrige verdi — den skal ikke velte hele forslaget.
  priceSource: z.enum(["prisfil", "lagret-jobb", "anslag"]).optional().catch(undefined),
  incomeAccountCategory: z
    .enum(["vare_videresalg", "vare_egenprodusert", "tjeneste", "annet"])
    .optional()
    .catch(undefined),
})

export const aiEditProposalSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(10_000),
  sourceSummary: z.string().max(5_000),
  lineItems: z.array(aiEditLineItemSchema).max(100),
})

export type AiEditProposal = z.infer<typeof aiEditProposalSchema>

export type ProposalIssue = {
  /** Sti i svaret, f.eks. «lineItems.2.unitPriceNok». Tom for hele svaret. */
  path: string
  message: string
  /** Det modellen faktisk skrev, forkortet. Bare enkle verdier. */
  received?: string | number | boolean | null
}

export type ParsedProposal =
  | { ok: true; proposal: AiEditProposal }
  | { ok: false; issues: ProposalIssue[] }

function stripCodeFence(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let current = root
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<PropertyKey, unknown>)[key]
  }
  return current
}

function shortValue(value: unknown): ProposalIssue["received"] {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 60)}…` : value
  return undefined
}

export function parseAiEditProposal(raw: string): ParsedProposal {
  if (!raw.trim()) {
    return { ok: false, issues: [{ path: "", message: "Tomt svar fra modellen." }] }
  }

  let json: unknown
  try {
    json = JSON.parse(stripCodeFence(raw))
  } catch {
    return { ok: false, issues: [{ path: "", message: "Svaret var ikke gyldig JSON." }] }
  }

  const result = aiEditProposalSchema.safeParse(json)
  if (result.success) return { ok: true, proposal: result.data }

  return {
    ok: false,
    issues: result.error.issues.slice(0, 20).map((issue) => {
      const received = shortValue(valueAt(json, issue.path))
      return {
        path: issue.path.map(String).join("."),
        message: issue.message,
        ...(received !== undefined ? { received } : {}),
      }
    }),
  }
}

/** Meldingen modellen får når svaret må rettes. */
export function repairInstruction(issues: ProposalIssue[]) {
  return [
    "Svaret ditt kan ikke brukes fordi det bryter disse reglene:",
    ...issues.slice(0, 10).map(
      (issue) =>
        `- ${issue.path || "hele svaret"}: ${issue.message}` +
        (issue.received !== undefined ? ` (du skrev ${JSON.stringify(issue.received)})` : "")
    ),
    "Rett feilene og returner hele tilbudet på nytt i samme JSON-form.",
    "Ingen tall er negative: et fradrag gjøres ved å redusere antall eller timer på linja det gjelder, eller med discountPercent.",
  ].join("\n")
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

export type ModelReply = {
  content: string
  model?: string
  finishReason?: string
}

export type ProposeResult =
  | { ok: true; proposal: AiEditProposal; reply: ModelReply; repaired: boolean }
  | { ok: false; issues: ProposalIssue[]; reply: ModelReply; repaired: boolean; repairError?: string }

/** Er det mindre tid enn dette igjen, prøver vi ikke å reparere. */
export const MIN_REPAIR_MS = 20_000

export async function proposeOfferEdit(options: {
  messages: ChatMessage[]
  callModel: (messages: ChatMessage[], timeoutMs: number) => Promise<ModelReply>
  /** Klokkeslett (ms) alt må være ferdig til — funksjonens maxDuration minus margin. */
  deadline: number
  firstCallTimeoutMs?: number
  now?: () => number
}): Promise<ProposeResult> {
  const now = options.now ?? Date.now
  const firstTimeout = Math.min(options.firstCallTimeoutMs ?? 90_000, options.deadline - now())
  const first = await options.callModel(options.messages, firstTimeout)
  const firstParse = parseAiEditProposal(first.content)
  if (firstParse.ok) return { ok: true, proposal: firstParse.proposal, reply: first, repaired: false }

  const remaining = options.deadline - now()
  if (remaining < MIN_REPAIR_MS) {
    return { ok: false, issues: firstParse.issues, reply: first, repaired: false }
  }

  let second: ModelReply
  try {
    second = await options.callModel(
      [
        ...options.messages,
        { role: "assistant", content: first.content },
        { role: "user", content: repairInstruction(firstParse.issues) },
      ],
      remaining
    )
  } catch (error) {
    // Reparasjonen er en bonus. Feiler den, er det den første feilen som forklarer.
    return {
      ok: false,
      issues: firstParse.issues,
      reply: first,
      repaired: false,
      repairError: error instanceof Error ? error.message : String(error),
    }
  }

  const secondParse = parseAiEditProposal(second.content)
  return secondParse.ok
    ? { ok: true, proposal: secondParse.proposal, reply: second, repaired: true }
    : { ok: false, issues: secondParse.issues, reply: second, repaired: true }
}
