import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { z } from "zod"

import { openaiFetch } from "@/lib/llm/openai-fetch"
import { logServerError } from "@/lib/errors/log"

// Offentlig KI-tilbudskalkulator (lead-magnet, ingen innlogging).
// Grensen på gratisbruk ligger i en cookie — bevisst lettvekts: volumet er
// lavt, kostnaden per kall er øre, og målet er registreringer, ikke vanntett
// kvotehåndhevelse. max_tokens + kort beskrivelse begrenser kostnadstaket.

const DAILY_LIMIT = 3
const LIMIT_COOKIE = "pa_kalk"

const bodySchema = z.object({
  beskrivelse: z.string().min(20, "Beskriv jobben litt mer utfyllende (minst 20 tegn).").max(2000),
  fag: z.enum(["tomrer", "elektriker", "rorlegger", "maler", "murer", "annet"]).optional(),
})

const FAG_LABELS: Record<string, string> = {
  tomrer: "tømrerarbeid",
  elektriker: "elektrikerarbeid",
  rorlegger: "rørleggerarbeid",
  maler: "maler- og overflatearbeid",
  murer: "murerarbeid",
  annet: "håndverksarbeid",
}

const SYSTEM_PROMPT = `Du er en erfaren norsk håndverksmester som setter opp profesjonelle pristilbud.
Basert på kundens beskrivelse av jobben lager du et komplett tilbudsutkast.

Returner KUN gyldig JSON på denne formen:
{
  "tittel": "Kort tittel på tilbudet, f.eks. «Tilbud: Utskifting av 12 vinduer»",
  "innledning": "2–3 setninger rettet til kunden: hva som skal gjøres og hvordan arbeidet utføres. Profesjonell og tillitvekkende, uten superlativer.",
  "linjer": [
    { "beskrivelse": "…", "mengde": 1, "enhet": "stk", "enhetsprisNok": 1000 }
  ],
  "forbehold": ["…", "…"]
}

Regler:
- 4–10 linjer som dekker hele jobben: arbeid, materialer, og rigg/drift eller avfallshåndtering der det er naturlig.
- Enheter: stk, m2, lm, time eller RS (rund sum).
- Realistiske norske priser (eks. mva): timepris håndverker 650–950 kr, materialpriser på normalt nivå. Runde tall.
- Hold beskrivelsene generelle nok til at de stemmer — ikke dikt opp detaljer kunden ikke har oppgitt.
- 2–4 nøkterne forbehold (f.eks. skjulte feil, tillegg ved råte, priser forutsetter fri tilkomst).
- Skriv på norsk bokmål. Ingen tekst utenfor JSON-objektet.`

function normalizeJsonFromModel(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
}

function osloToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date())
}

type Linje = { beskrivelse: string; mengde: number; enhet: string; enhetsprisNok: number; sumNok: number }

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Ugyldig forespørsel." },
        { status: 400 }
      )
    }

    // Dagsgrense per nettleser
    const today = osloToday()
    const cookieStore = await cookies()
    const [cookieDate, cookieCount] = (cookieStore.get(LIMIT_COOKIE)?.value ?? "").split(":")
    const usedToday = cookieDate === today ? Number(cookieCount) || 0 : 0
    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json(
        {
          error: `Du har brukt dagens ${DAILY_LIMIT} gratis tilbud. Registrer deg gratis for å lage så mange du vil — uten kort.`,
          code: "limit",
        },
        { status: 429 }
      )
    }

    const fagLabel = FAG_LABELS[parsed.data.fag ?? "annet"]
    const userPrompt = [
      `Fagområde: ${fagLabel}`,
      "",
      "Kundens beskrivelse av jobben:",
      parsed.data.beskrivelse.trim(),
    ].join("\n")

    const response = await openaiFetch("chat/completions", {
      model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
      response_format: { type: "json_object" },
      max_completion_tokens: 1600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    const raw = payload.choices?.[0]?.message?.content || "{}"
    const draft = JSON.parse(normalizeJsonFromModel(raw)) as {
      tittel?: string
      innledning?: string
      linjer?: Array<{ beskrivelse?: string; mengde?: number; enhet?: string; enhetsprisNok?: number }>
      forbehold?: string[]
    }

    // Aldri stol på modellens regning — alle summer regnes her.
    const linjer: Linje[] = (draft.linjer ?? [])
      .filter((l) => l && typeof l.beskrivelse === "string" && l.beskrivelse.trim())
      .slice(0, 12)
      .map((l) => {
        const mengde = Math.max(0, Math.round((Number(l.mengde) || 1) * 100) / 100)
        const enhetsprisNok = Math.max(0, Math.round(Number(l.enhetsprisNok) || 0))
        return {
          beskrivelse: String(l.beskrivelse).trim().slice(0, 200),
          mengde,
          enhet: String(l.enhet || "stk").slice(0, 10),
          enhetsprisNok,
          sumNok: Math.round(mengde * enhetsprisNok),
        }
      })

    if (linjer.length === 0 || !draft.tittel) {
      throw new Error("KI returnerte tomt tilbud")
    }

    const subtotalNok = linjer.reduce((acc, l) => acc + l.sumNok, 0)
    const mvaNok = Math.round(subtotalNok * 0.25)

    const res = NextResponse.json({
      tilbud: {
        tittel: String(draft.tittel).slice(0, 120),
        innledning: String(draft.innledning || "").slice(0, 600),
        linjer,
        forbehold: (draft.forbehold ?? []).map((f) => String(f).slice(0, 200)).slice(0, 5),
        subtotalNok,
        mvaNok,
        totalNok: subtotalNok + mvaNok,
      },
      remaining: DAILY_LIMIT - usedToday - 1,
    })
    res.cookies.set(LIMIT_COOKIE, `${today}:${usedToday + 1}`, {
      path: "/",
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      sameSite: "lax",
    })
    return res
  } catch (error) {
    console.error("[kalkulator]", error)
    await logServerError({
      message: "Gratis tilbudskalkulator feilet",
      error,
      source: "api",
      route: "/api/kalkulator",
    })
    return NextResponse.json(
      { error: "Kunne ikke lage tilbudet akkurat nå. Prøv igjen om et øyeblikk." },
      { status: 500 }
    )
  }
}
