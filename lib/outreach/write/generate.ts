// Skrivemotoren: «skriv som Casper».
//
// Flyten er:
//   dossier + playbook + faktaark + læringsminne
//     → ett strukturert kall
//     → lint (kode, blokkerende)
//     → stryker den: ÉN omskriving med konkret tilbakemelding
//     → stryker den igjen: prospektet blir for_tynn, og det skrives ingen e-post
//     → består den: sensoren gir karakter, og utkastet går til godkjenning
//
// Merk hva som IKKE skjer her: ingenting sendes. Fase 1 stopper i
// godkjenningskøen, og det er Casper som slipper meldingen videre.

import { logServerError } from "@/lib/errors/log"
import { asRecord, asString, defaultModel, structuredCall } from "@/lib/llm/structured"
import { createAdminClient } from "@/lib/supabase/admin"
import { factsForPrompt } from "@/lib/outreach/facts"
import type { Hook } from "@/lib/outreach/research/synthesize"
import { getSegment } from "@/lib/outreach/segments"
import type { ProspectRow } from "@/lib/outreach/types"
import { gradeMessage, type GradeReport } from "@/lib/outreach/write/grade"
import { lintMessage, WORD_LIMITS, type LintReport } from "@/lib/outreach/write/lint"
import { loadLearningMemory, memoryForPrompt } from "@/lib/outreach/write/learning"
import { anglesFor, FOLLOWUP_BRIEF, playbookForPrompt } from "@/lib/outreach/write/playbooks"

export const SIGNATURE = "Casper Nag\nProanbud — et produkt fra Nag Software, Holmestrand"

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["emne", "brodtekst", "krok_id", "fakta_ids", "vinkel"],
  properties: {
    emne: { type: "string", description: "2-5 ord. Konkret. Ingen clickbait, ingen emojier." },
    brodtekst: {
      type: "string",
      description:
        "Hele e-posten, ren tekst, fra «Hei,» til og med signaturen. Ingen lenker, ingen avmeldingstekst.",
    },
    krok_id: { type: "string", description: "Id-en til kroken du bygde på." },
    fakta_ids: {
      type: "array",
      items: { type: "string" },
      description: "Id-ene fra faktaarket du brukte, f.eks. pris_proff.",
    },
    vinkel: { type: "string", description: "Id-en til vinkelen du valgte." },
  },
}

function systemPrompt(step: number): string {
  return `Du skriver e-poster på vegne av Casper Nag, som har laget Proanbud — et norsk system der håndverkeres tilbud, prosjekter, timer og faktura henger sammen. Målet er ett svar, ikke et salg.

Stilen er Caspers egen:
- Norsk bokmål. Kort. Som en som har stått på en byggeplass, ikke som en reklame.
- Start med «Hei,» på egen linje.
- FØRSTE SETNING er observasjonen fra kroken du får — konkret, om akkurat dette firmaet. Ikke pynt på den, og ikke legg til noe den ikke dekker.
- Så én til to setninger om hva Proanbud gjør med problemet i vinkelen, med ordene fra faktaarket.
- Avslutt med ETT lavterskel-spørsmål som kan besvares med én setning. Aldri «book et møte».
- Maks ${WORD_LIMITS[step] ?? 120} ord før signaturen. Ingen emojier. Ingen utropstegn.
- Ingen lenker, ingen kontaktinfo, ingen avmeldingstekst — det legges på automatisk.
- Avslutt brødteksten med nøyaktig denne signaturen:
${SIGNATURE}

Faktaarket er ALT du kan påstå om Proanbud:
${factsForPrompt("handverker")}

Ufravikelig:
- Hvert tall du skriver må stå i faktaarket eller i dossieret. Ingen unntak, heller ikke «rundt 20 %».
- Aldri tall om mottakerens omsetning, resultat eller antall ansatte. De er interne.
- Aldri: løsning, synergi, digitalisering, effektivisering, sømløs, revolusjonerende.
- Nevner du pris sammen med regnskapsintegrasjon, må du også si hva integrasjonen koster (inkludert i Proff, tillegg på Mini).`
}

export type DraftInput = {
  prospect: ProspectRow
  hooks: Hook[]
  summary: string | null
  pains: string[]
  bestAngle: string | null
  step: number
  /** Emnet fra steg 1, så steg 2–3 kan tråde som «Re:». */
  previousSubject?: string | null
  /** Teksten i steg 1, så oppfølgingen ikke gjentar seg selv. */
  previousBody?: string | null
}

export type DraftResult =
  | {
      ok: true
      subject: string
      body: string
      hook: Hook
      hookId: string
      factIds: string[]
      angle: string
      lint: LintReport
      grade: GradeReport | null
      cost_usd: number
      rewritten: boolean
    }
  | { ok: false; reason: string; lint: LintReport | null; cost_usd: number }

function userPrompt(input: DraftInput, hook: Hook, memory: string): string {
  const prospect = input.prospect
  const segment = getSegment(prospect.segment)
  const angles = anglesFor(prospect.trade)

  return [
    `Firma: ${prospect.name}`,
    prospect.city ? `Sted: ${prospect.city}` : null,
    prospect.nace_description ? `Fag: ${prospect.nace_description}` : null,
    "",
    "── Kroken du SKAL bygge første setning på ──",
    `Observasjon: ${hook.text}`,
    `Dette står ordrett på nettsiden deres: «${hook.quote}»`,
    `Kilde: ${hook.source_url}`,
    "",
    input.summary ? `Om firmaet: ${input.summary}` : null,
    input.pains.length > 0 ? `Sannsynlige problemer: ${input.pains.join("; ")}` : null,
    input.bestAngle ? `Foreslått vinkel: ${input.bestAngle}` : null,
    "",
    "── Playbook ──",
    playbookForPrompt(segment.key, prospect.trade),
    "",
    angles.length > 0 ? `Velg vinkel-id fra: ${angles.map((angle) => angle.id).join(", ")}` : null,
    "",
    input.step > 1 ? FOLLOWUP_BRIEF[input.step] ?? "" : null,
    input.step > 1 && input.previousBody
      ? `Dette sendte du i steg 1 — ikke gjenta det:\n${input.previousBody}`
      : null,
    "",
    memory,
  ]
    .filter((line) => line !== null && line !== "")
    .join("\n")
}

type RawDraft = { subject: string; body: string; hookId: string; factIds: string[]; angle: string }

async function callWriter(
  input: DraftInput,
  hook: Hook,
  memory: string,
  correction: string | null,
): Promise<{ draft: RawDraft | null; cost: number; error: string | null }> {
  const user = correction
    ? `${userPrompt(input, hook, memory)}\n\n── Forrige utkast ble avvist ──\n${correction}\n\nSkriv e-posten på nytt uten disse feilene. Behold observasjonen i første setning.`
    : userPrompt(input, hook, memory)

  const result = await structuredCall(
    {
      model: process.env.SALG_WRITE_MODEL || defaultModel(),
      schemaName: "outreach_message",
      schema: SCHEMA,
      system: systemPrompt(input.step),
      user,
      maxOutputTokens: 1200,
      timeoutMs: 45000,
    },
    (value) => {
      const root = asRecord(value)
      return {
        subject: asString(root.emne),
        body: asString(root.brodtekst),
        hookId: asString(root.krok_id) || hook.id,
        factIds: Array.isArray(root.fakta_ids)
          ? root.fakta_ids.map((id) => asString(id)).filter(Boolean)
          : [],
        angle: asString(root.vinkel),
      }
    },
  )

  if (!result.ok) {
    return { draft: null, cost: result.usage?.cost_usd ?? 0, error: result.error }
  }
  return { draft: result.data, cost: result.usage.cost_usd, error: null }
}

/**
 * Skriver ett utkast. Returnerer alltid — en feilet skriving skal aldri velte
 * en tick, og et utkast som ikke består lint blir aldri sendt.
 */
export async function draftMessage(input: DraftInput): Promise<DraftResult> {
  const grounded = input.hooks.filter((hook) => hook.grounded)
  if (grounded.length === 0) {
    return {
      ok: false,
      reason: "Ingen validert krok — det finnes ingenting ekte å skrive om",
      lint: null,
      cost_usd: 0,
    }
  }

  const hook = grounded[0]
  const segment = getSegment(input.prospect.segment)
  const memory = memoryForPrompt(await loadLearningMemory(segment.key))
  const dossierText = [input.summary, ...input.pains, ...grounded.map((item) => item.text)]
    .filter(Boolean)
    .join(" ")

  let cost = 0
  let correction: string | null = null

  // Ett forsøk, så én omskriving. Ikke mer — en modell som bommer to ganger
  // på det samme kommer ikke til å treffe på det tredje.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { draft, cost: attemptCost, error } = await callWriter(input, hook, memory, correction)
    cost += attemptCost

    if (!draft) {
      if (attempt === 1) {
        return { ok: false, reason: `Skriveren feilet: ${error}`, lint: null, cost_usd: cost }
      }
      correction = "Forrige forsøk ga ikke gyldig svar. Følg skjemaet nøyaktig."
      continue
    }

    const lint = lintMessage({
      subject: draft.subject,
      body: draft.body,
      step: input.step,
      hook,
      dossierText,
      allowLink: input.step > 1,
    })

    if (lint.ok) {
      let grade: GradeReport | null = null
      try {
        grade = await gradeMessage({
          subject: draft.subject,
          body: draft.body,
          step: input.step,
          hookText: hook.text,
          hookQuote: hook.quote,
          companyName: input.prospect.name,
        })
        cost += grade.usage?.cost_usd ?? 0
      } catch (error) {
        void logServerError({
          message: "Sensoren feilet",
          level: "warning",
          source: "worker",
          error,
          context: { prospectId: input.prospect.id },
        })
      }

      return {
        ok: true,
        subject: draft.subject,
        body: draft.body,
        hook,
        hookId: draft.hookId,
        factIds: draft.factIds,
        angle: draft.angle,
        lint,
        grade,
        cost_usd: cost,
        rewritten: attempt > 0,
      }
    }

    if (attempt === 1) {
      return {
        ok: false,
        reason: `Utkastet strøk på lint to ganger:\n${lint.feedback}`,
        lint,
        cost_usd: cost,
      }
    }
    correction = lint.feedback
  }

  return { ok: false, reason: "Uventet: skrivesløyfen ga ikke resultat", lint: null, cost_usd: cost }
}

// ── Lagring ─────────────────────────────────────────────────────────────────

export type PersistedMessage = { id: string; status: string }

/**
 * Lagrer utkastet i godkjenningskøen og setter prospektet til
 * `til_godkjenning`. Den unike indeksen (prospect_id, step) gjør kallet
 * idempotent — to ticks kan ikke lage to utkast for samme steg.
 */
export async function persistDraft(input: {
  prospectId: string
  researchId: string | null
  step: number
  draft: Extract<DraftResult, { ok: true }>
  ttlDays: number
}): Promise<PersistedMessage | null> {
  const supabase = createAdminClient()
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("outreach_messages")
    .insert({
      prospect_id: input.prospectId,
      research_id: input.researchId,
      step: input.step,
      kind: input.step === 1 ? "kald" : "oppfolging",
      subject: input.draft.subject,
      body_ai: input.draft.body,
      angle: input.draft.angle,
      hook_id: input.draft.hookId,
      fact_ids: input.draft.factIds,
      lint: input.draft.lint,
      grade: input.draft.grade?.score ?? null,
      grade_report: input.draft.grade
        ? { ...input.draft.grade, usage: undefined }
        : null,
      status: "til_godkjenning",
      expires_at: expiresAt,
    })
    .select("id, status")
    .single()

  if (error) {
    // 23505 = den unike indeksen slo til. Det betyr at utkastet allerede finnes,
    // og det er riktig utfall, ikke en feil.
    if (error.code !== "23505") {
      void logServerError({
        message: "Kunne ikke lagre utkast",
        level: "error",
        source: "worker",
        error,
        context: { prospectId: input.prospectId, step: input.step },
      })
    }
    return null
  }

  await supabase
    .from("prospects")
    .update({ pipeline_state: "til_godkjenning" })
    .eq("id", input.prospectId)
    .eq("pipeline_state", "kvalifisert")

  return data
}
