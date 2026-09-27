// Skrivemotoren for varm oppfølging.
//
// Samme løkke som den kalde (skriv → lint → én omskriving → sensor), men et
// annet utgangspunkt. Mottakeren laget selv et eksempeltilbud og krysset av
// for oppfølging. Det finnes ingen krok å bygge på og ingenting å gjette om —
// vi vet hvilken jobb de prøvde og hva summen ble. E-posten skal høres ut som
// oppfølging av noe de ba om, ikke som en kald henvendelse med ny pynt.

import { asRecord, asString, defaultModel, structuredCall } from "@/lib/llm/structured"
import { logServerError } from "@/lib/errors/log"
import { factsForPrompt } from "@/lib/outreach/facts"
import { buildWarmSignupUrl } from "@/lib/outreach/lenker"
import { gradeMessage, type GradeReport } from "@/lib/outreach/write/grade"
import type { LintReport } from "@/lib/outreach/write/lint"
import { SIGNATURE } from "@/lib/outreach/write/generate"
import {
  analyseFactsText,
  formatNok,
  lintWarmMessage,
  WARM_WORD_LIMITS,
  type AnalyseFacts,
} from "@/lib/outreach/varm-regler"

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["emne", "brodtekst", "fakta_ids"],
  properties: {
    emne: { type: "string", description: "2-5 ord. Konkret, om jobben i eksempeltilbudet. Ingen emojier." },
    brodtekst: {
      type: "string",
      description: "Hele e-posten, ren tekst, fra «Hei,» til og med signaturen. Ingen avmeldingstekst.",
    },
    fakta_ids: {
      type: "array",
      items: { type: "string" },
      description: "Id-ene fra faktaarket du brukte, f.eks. egne_prisfiler.",
    },
  },
}

function systemPrompt(step: number): string {
  return `Du skriver en kort oppfølging på vegne av Casper Nag, som har laget Proanbud — et norsk system der håndverkeres tilbud, prosjekter, timer og faktura henger sammen.

Dette er IKKE en kald e-post. Mottakeren la selv inn nettsiden sin på proanbud.no, fikk et eksempeltilbud på e-post, og krysset av for at Casper kunne følge opp. Skriv som en som følger opp noe de ba om — rolig, uten å selge.

Stilen er Caspers egen:
- Norsk bokmål. Kort. Som en som har stått på en byggeplass, ikke som en reklame.
- Start med «Hei,» på egen linje.
- FØRSTE SETNING viser til eksempeltilbudet de laget — jobben det gjaldt. Ikke gjenta hele tilbudet.
- Ikke skriv NÅR de laget det («i går», «på tirsdag») — e-posten kan bli sendt noen dager senere.
- Avslutt med ETT spørsmål som kan besvares med én setning. Aldri «book et møte».
- Maks ${WARM_WORD_LIMITS[step] ?? 60} ord før signaturen. Ingen emojier. Ingen utropstegn.
- ${step === 1 ? "Ingen lenker" : "Høyst én lenke, og bare den du får oppgitt"}. Ingen kontaktinfo, ingen avmeldingstekst — det legges på automatisk.
- Avslutt brødteksten med nøyaktig denne signaturen:
${SIGNATURE}

Faktaarket er ALT du kan påstå om Proanbud:
${factsForPrompt("handverker")}

Ufravikelig:
- Hvert tall du skriver må stå i faktaarket eller i opplysningene om analysen. Ingen unntak.
- Skriv aldri «KI». Si hva systemet gjør.
- Eksempeltilbudet var et eksempel. Ikke påstå at prisen var riktig for dem — spør.
- Aldri: løsning, synergi, digitalisering, effektivisering, sømløs, revolusjonerende.`
}

/** Hva hvert steg skal gjøre. */
function stepBrief(step: number, signupUrl: string): string {
  if (step === 1) {
    return [
      "Steg 1 av 2.",
      "Første setning: at du så de laget et eksempeltilbud på jobben over.",
      "Spørsmålet er om summen og linjene var i nærheten av slik de selv ville priset den jobben.",
      "Du kan nevne ÉN ting fra faktaarket som henger sammen med det — for eksempel at et ekte tilbud bygges fra deres egne priser.",
      "Ingen lenke.",
    ].join("\n")
  }
  return [
    "Steg 2 av 2 — siste e-post. Den forrige er ikke besvart.",
    "Si rett ut at dette er siste gang du tar kontakt om eksempeltilbudet, uten å beklage.",
    "Nevn prøveperioden slik faktaarket beskriver den, og legg ved DENNE ene lenken, ordrett:",
    signupUrl,
    "Ett spørsmål til slutt.",
  ].join("\n")
}

export type WarmDraftInput = {
  prospectName: string
  facts: AnalyseFacts
  step: number
  /** Emnet fra steg 1 — steg 2 går i samme tråd. */
  previousSubject?: string | null
  /** Teksten i steg 1, så steg 2 ikke gjentar den. */
  previousBody?: string | null
}

export type WarmDraftResult =
  | {
      ok: true
      subject: string
      body: string
      factIds: string[]
      lint: LintReport
      grade: GradeReport | null
      cost_usd: number
      rewritten: boolean
    }
  | { ok: false; reason: string; lint: LintReport | null; cost_usd: number }

function userPrompt(input: WarmDraftInput): string {
  return [
    "── Det mottakeren gjorde ──",
    analyseFactsText(input.facts),
    "",
    "── Dette steget ──",
    stepBrief(input.step, buildWarmSignupUrl()),
    input.step > 1 && input.previousBody ? `\nDette sendte du i steg 1 — ikke gjenta det:\n${input.previousBody}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n")
}

type RawDraft = { subject: string; body: string; factIds: string[] }

async function callWriter(
  input: WarmDraftInput,
  correction: string | null,
): Promise<{ draft: RawDraft | null; cost: number; error: string | null }> {
  const user = correction
    ? `${userPrompt(input)}\n\n── Forrige utkast ble avvist ──\n${correction}\n\nSkriv e-posten på nytt uten disse feilene.`
    : userPrompt(input)

  const result = await structuredCall(
    {
      model: process.env.SALG_WRITE_MODEL || defaultModel(),
      schemaName: "varm_oppfolging",
      schema: SCHEMA,
      system: systemPrompt(input.step),
      user,
      maxOutputTokens: 1000,
      timeoutMs: 45000,
    },
    (value) => {
      const root = asRecord(value)
      return {
        subject: asString(root.emne),
        body: asString(root.brodtekst),
        factIds: Array.isArray(root.fakta_ids)
          ? root.fakta_ids.map((id) => asString(id)).filter(Boolean)
          : [],
      }
    },
  )

  if (!result.ok) return { draft: null, cost: result.usage?.cost_usd ?? 0, error: result.error }
  return { draft: result.data, cost: result.usage.cost_usd, error: null }
}

/**
 * Skriver ett varmt utkast. Returnerer alltid — en feilet skriving skal aldri
 * velte en tick, og et utkast som ikke består lint blir aldri sendt. Da tar
 * Casper det selv i stedet (varm.ts lager oppgaven).
 */
export async function draftWarmMessage(input: WarmDraftInput): Promise<WarmDraftResult> {
  let cost = 0
  let correction: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const { draft, cost: attemptCost, error } = await callWriter(input, correction)
    cost += attemptCost

    if (!draft) {
      if (attempt === 1) return { ok: false, reason: `Skriveren feilet: ${error}`, lint: null, cost_usd: cost }
      correction = "Forrige forsøk ga ikke gyldig svar. Følg skjemaet nøyaktig."
      continue
    }

    // Steg 2 går i samme tråd som steg 1 — utsendingen legger på «Re:».
    const subject =
      input.step > 1 && input.previousSubject
        ? input.previousSubject.replace(/^re:\s*/i, "")
        : draft.subject

    const lint = lintWarmMessage({ subject, body: draft.body, step: input.step, facts: input.facts })

    if (lint.ok) {
      let grade: GradeReport | null = null
      try {
        grade = await gradeMessage({
          subject,
          body: draft.body,
          step: input.step,
          hookText: [
            "Mottakeren laget selv et eksempeltilbud på proanbud.no og ba om oppfølging",
            input.facts.jobTitle ? `— jobben var «${input.facts.jobTitle}»` : null,
            input.facts.offerTotal !== null ? `(${formatNok(input.facts.offerTotal)} kr eks. mva)` : null,
          ]
            .filter(Boolean)
            .join(" "),
          hookQuote: null,
          companyName: input.prospectName,
        })
        cost += grade.usage?.cost_usd ?? 0
      } catch (error) {
        void logServerError({
          message: "Sensoren feilet for varm oppfølging",
          level: "warning",
          source: "worker",
          error,
        })
      }

      return {
        ok: true,
        subject,
        body: draft.body,
        factIds: draft.factIds,
        lint,
        grade,
        cost_usd: cost,
        rewritten: attempt > 0,
      }
    }

    if (attempt === 1) {
      return { ok: false, reason: `Utkastet strøk på lint to ganger:\n${lint.feedback}`, lint, cost_usd: cost }
    }
    correction = lint.feedback
  }

  return { ok: false, reason: "Uventet: skrivesløyfen ga ikke resultat", lint: null, cost_usd: cost }
}
