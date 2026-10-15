/**
 * Ett KI-kall som skal gi gyldig JSON, med én reparasjonsrunde: er svaret
 * ugyldig og det er tid igjen, får modellen sitt eget svar og en liste over
 * feilene tilbake og prøver én gang til. Samme oppskrift som
 * proposeOfferEdit (lib/tilbud/ai-edit-proposal), men uten tilbudsspesifikk
 * parsing, så andre KI-funksjoner (SmartKI i kalkylen) kan bruke den.
 */

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string }
export type LlmReply = { content: string; model?: string; finishReason?: string }
export type LlmIssue = { path: string; message: string; received?: unknown }
export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: LlmIssue[] }

/** Reparasjonsrunden kjøres bare med minst så mye tid igjen. */
export const MIN_REPAIR_MS = 20_000

export type ProposeResult<T> =
  | { ok: true; value: T; reply: LlmReply; repaired: boolean }
  | { ok: false; issues: LlmIssue[]; reply: LlmReply; repaired: boolean; repairError?: string }

export async function proposeWithRepair<T>({
  messages,
  callModel,
  parse,
  repairInstruction,
  deadline,
  firstCallTimeoutMs = 90_000,
  now = Date.now,
}: {
  messages: LlmMessage[]
  callModel: (messages: LlmMessage[], timeoutMs: number) => Promise<LlmReply>
  parse: (raw: string) => Parsed<T>
  repairInstruction: (issues: LlmIssue[]) => string
  deadline: number
  firstCallTimeoutMs?: number
  now?: () => number
}): Promise<ProposeResult<T>> {
  const first = await callModel(messages, Math.max(1_000, Math.min(firstCallTimeoutMs, deadline - now())))
  const parsed = parse(first.content)
  if (parsed.ok) return { ok: true, value: parsed.value, reply: first, repaired: false }

  const remaining = deadline - now()
  if (remaining < MIN_REPAIR_MS) return { ok: false, issues: parsed.issues, reply: first, repaired: false }

  try {
    const second = await callModel(
      [...messages, { role: "assistant", content: first.content }, { role: "user", content: repairInstruction(parsed.issues) }],
      remaining
    )
    const retried = parse(second.content)
    if (retried.ok) return { ok: true, value: retried.value, reply: second, repaired: true }
    return { ok: false, issues: retried.issues, reply: second, repaired: true }
  } catch (error) {
    return {
      ok: false,
      issues: parsed.issues,
      reply: first,
      repaired: true,
      repairError: error instanceof Error ? error.message : String(error),
    }
  }
}
