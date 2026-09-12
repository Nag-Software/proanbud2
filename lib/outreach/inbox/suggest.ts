// Forslag til svar.
//
// Forslaget sendes ALDRI automatisk. Det ligger ferdig i composeren på
// lead-kortet, og Casper trykker send. Grunnen er enkel: fra det øyeblikket
// noen har svart, er det en samtale mellom to mennesker, og den eneste
// virkelige verdien Proanbud har å tilby er at han faktisk svarer selv.
//
// Det forslaget gjør, er å fjerne de fem minuttene det tar å finne igjen hva
// saken gjaldt.

import { asRecord, asString, structuredCall } from "@/lib/llm/structured"
import { factsForPrompt } from "@/lib/outreach/facts"
import type { RawMessage } from "@/lib/outreach/inbox/imap"
import type { ReplyClass } from "@/lib/outreach/inbox/classify"

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["svar", "merknad"],
  properties: {
    svar: { type: "string", description: "Hele svaret, ren tekst, klart til å sendes." },
    merknad: {
      type: "string",
      description: "Én setning til Casper om hva du la vekt på, eller hva han bør sjekke.",
    },
  },
}

const SYSTEM = `Du skriver utkast til svar på vegne av Casper Nag, som selger Proanbud til håndverksbedrifter.

Noen har svart på en kald e-post. Nå er det en samtale, ikke en kampanje.

Slik svarer Casper:
- Kort. To til fire setninger.
- Svar på det de faktisk spurte om, før du sier noe annet.
- Ingen selgerspråk, ingen superlativer, ingen «flott at du tok kontakt».
- Er de interessert: foreslå det minste neste steget — en kort telefon, eller at han sender et eksempel.
- Vet du ikke svaret, si at han sjekker og kommer tilbake. Ikke finn på.
- Ingen emojier, ingen utropstegn.
- Ikke skriv signatur — den legges på.

Alt du kan påstå om Proanbud:
${factsForPrompt("handverker")}

Innvendinger og hvordan de møtes:
- «Vi har allerede et system»: spør hva de bruker, og hva som ikke fungerer der i dag.
- «Har ikke tid nå»: si at det tar ti minutter å prøve, og spør når det passer bedre.
- «For dyrt»: sammenlign med tiden ett tilbud tar i dag. Ikke gi rabatt.
- «Er dette KI?»: svar ærlig at han bruker verktøy til research, men at han leser og sender selv.`

export type ReplySuggestion = {
  text: string
  note: string
  cost_usd: number
}

export async function suggestReply(input: {
  message: RawMessage
  klasse: ReplyClass
  companyName: string
  /** Vår siste melding i tråden, så svaret henger sammen. */
  ourLastMessage: string | null
}): Promise<ReplySuggestion | null> {
  const user = [
    `Firma: ${input.companyName}`,
    `Klassifisering: ${input.klasse}`,
    "",
    input.ourLastMessage ? `Dette skrev Casper sist:\n${input.ourLastMessage}` : null,
    "",
    `De svarte:\n${input.message.text.slice(0, 4000)}`,
  ]
    .filter((line) => line !== null)
    .join("\n")

  const result = await structuredCall(
    {
      model: process.env.SALG_REPLY_MODEL || process.env.OPENAI_MODEL || "gpt-5.2-mini",
      schemaName: "svar_forslag",
      schema: SCHEMA,
      system: SYSTEM,
      user,
      maxOutputTokens: 700,
      timeoutMs: 30000,
    },
    (value) => {
      const root = asRecord(value)
      return { svar: asString(root.svar), merknad: asString(root.merknad) }
    },
  )

  if (!result.ok || !result.data.svar) return null

  return {
    text: result.data.svar,
    note: result.data.merknad,
    cost_usd: result.usage.cost_usd,
  }
}
