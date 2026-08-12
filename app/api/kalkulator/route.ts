import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { z } from "zod"

import { openaiFetch } from "@/lib/llm/openai-fetch"
import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPromptSections,
} from "@/lib/tilbud/analysis-system-prompt"
import { matchNorwegianSupplierPrices } from "@/lib/tilbud/supplier-prices"
import {
  formatMaterialSearchHitsForPrompt,
  searchMaterialPricesForOffer,
} from "@/lib/tilbud/material-web-search"
import {
  formatNormalPriceForPrompt,
  mapNormalPriceRows,
  pickBestNormalPrice,
} from "@/lib/tilbud/normal-prices"
import { finalizeGeneratedOfferLineItems } from "@/lib/tilbud/company-price-utils"
import { calculateOfferTotals, type OfferLineItem } from "@/lib/tilbud/types"

// Offentlig KI-tilbudskalkulator (lead-magnet, ingen innlogging).
//
// Bruker NØYAKTIG samme motor som det interne /api/tilbud/analyse:
// ANALYSIS_SYSTEM_PROMPT + samme oppdragsgrunnlag med materialpriser fra
// nettprissøk (Brave), innebygd norsk leverandørkatalog som fallback og
// normalpris-indikator — bare uten bedriftens prisfiler/lagrede jobber
// (anonym bruker har ingen). Grensen på gratisbruk ligger i en cookie —
// bevisst lettvekts: volumet er lavt og målet er registreringer.

const DAILY_LIMIT = Math.max(1, Number(process.env.KALKULATOR_DAILY_LIMIT) || 3)
const LIMIT_COOKIE = "pa_kalk"

// Nettprissøk + full analyse tar gjerne 20–40s — samme takhøyde som analyse-ruten.
export const maxDuration = 60

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

// Samme linje-/svarskjema som /api/tilbud/analyse.
const aiLineItemSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  reasoning: z.string().trim().default(""),
  quantity: z.number().min(0).default(1),
  unit: z.string().trim().default("stk"),
  subproject: z.string().trim().default("Generelt"),
  supplier: z.string().trim().default(""),
  nobb: z.string().trim().optional(),
  supplierSku: z.string().trim().optional(),
  // Modellen følger prompt-eksemplet og sender ofte "" — behandle som utelatt.
  supplierUrl: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().url().optional()
  ),
  unitPriceNok: z.number().min(0),
  markupPercent: z.number().min(0).max(100).default(15),
  discountPercent: z.number().min(0).max(100).default(0),
  // Intern kildemerking (prisfil/lagret-jobb/anslag). Uten den her stripper zod
  // feltet ved lagring, og «Anslag»-merket forsvinner i det tilbudet lagres.
  priceSource: z.enum(["prisfil", "lagret-jobb", "anslag"]).optional(),
})

const aiResponseSchema = z.object({
  summary: z.string().trim().default(""),
  reasoning: z.string().trim().default(""),
  warnings: z.array(z.string().trim()).default([]),
  lineItems: z.array(aiLineItemSchema).min(1),
})

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

function toOfferLineItems(items: z.infer<typeof aiLineItemSchema>[]): OfferLineItem[] {
  return items.map((item) => ({
    id: crypto.randomUUID(),
    subproject: item.subproject || "Generelt",
    title: item.title,
    description: item.description,
    reasoning: item.reasoning || undefined,
    quantity: item.quantity,
    unit: item.unit,
    supplier: item.supplier,
    nobb: item.nobb,
    supplierSku: item.supplierSku,
    supplierUrl: item.supplierUrl,
    unitPriceNok: item.unitPriceNok,
    markupPercent: item.markupPercent,
    discountPercent: item.discountPercent,
  }))
}

/**
 * Enhets-sanering: «time» gir bare mening for arbeid/transport, som per
 * systemprompten har påslag 0. Materiallinjer med påslag som feilaktig får
 * unit "time" (modellvarians) gjøres om til stk/RS, så dokumentet aldri
 * viser «12 time trevinduer».
 */
function sanitizeUnits(items: OfferLineItem[]): OfferLineItem[] {
  return items.map((item) => {
    if (item.unit === "time" && item.markupPercent > 0) {
      return { ...item, unit: item.quantity === 1 ? "RS" : "stk" }
    }
    return item
  })
}

/** Tittel utledes av beskrivelsens første setning — analyse-motoren krever en. */
function deriveTitle(beskrivelse: string, fagLabel: string): string {
  const firstSentence = beskrivelse.split(/[.!?\n]/)[0]?.trim() ?? ""
  if (firstSentence.length >= 8) return firstSentence.slice(0, 90)
  return `Pristilbud – ${fagLabel}`
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Ugyldig forespørsel." },
        { status: 400 }
      )
    }

    // Dagsgrense per nettleser — sjekkes FØR nettsøk/KI-kall.
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
    const beskrivelse = parsed.data.beskrivelse.trim()
    const title = deriveTitle(beskrivelse, fagLabel)
    // Kalibreringen ligger i oppdragsgrunnlaget (caller-styrt felt), IKKE i
    // systemprompten — motoren og promptmodellen er identisk med /api/tilbud/analyse.
    const sourceSummary =
      `Fagområde: ${fagLabel}. Forespørsel fra Proanbuds gratis tilbudskalkulator. ` +
      `Kalkylen skal være KOMPLETT: alle nødvendige materialer skal med som egne linjer — også ` +
      `hovedproduktene som leveres (f.eks. selve vinduene, dørene, flisene). ` +
      `Timeforbruk estimeres som en effektiv, erfaren fagperson uten buffer — usikkerhet håndteres ` +
      `som warnings/forbehold, ikke i timetallet. Stillas og rigg prises som RS (leie/oppsett), ikke som timer.`
    const query = `${title}\n${beskrivelse}\n${sourceSummary}`

    // Materialgrunnlag — samme kilder som den interne motoren:
    // nettprissøk (best-effort), fallback-katalog og normalpris-indikator.
    const [materialSearchHits, normalPriceRows] = await Promise.all([
      searchMaterialPricesForOffer({
        title,
        description: beskrivelse,
        sourceSummary,
        subprojects: [],
      }).catch((error) => {
        console.warn("[kalkulator] nettprissøk feilet — fortsetter uten", error)
        return []
      }),
      createAdminClient()
        .from("normal_prices")
        .select(
          "id, project_type, slug, price_low_nok, price_normal_nok, price_high_nok, typical_total_min_nok, typical_total_max_nok, unit"
        )
        .order("sort_order", { ascending: true })
        .then(({ data }) => data ?? []),
    ])

    const externalPrices = formatMaterialSearchHitsForPrompt(materialSearchHits)
    const matchedNormalPrice = pickBestNormalPrice(mapNormalPriceRows(normalPriceRows as unknown[]), query)
    const normalPriceIndicator = matchedNormalPrice ? formatNormalPriceForPrompt(matchedNormalPrice) : null
    const supplierMatches = matchNorwegianSupplierPrices({
      description: query,
      subprojects: [],
    })

    const userPrompt = buildAnalysisUserPromptSections({
      contextJson: {
        request: {
          title,
          description: beskrivelse,
          sourceSummary,
          subprojects: [],
        },
        prisfiler: {
          filer: [],
          fallbackProdukter: supplierMatches,
        },
        eksternePriser: externalPrices,
        normalPrisIndikator: normalPriceIndicator,
        lagredeJobber: [],
        relevanteLagredeJobber: [],
        outputRequirements: {
          minLineItems: 6,
          maxLineItems: 30,
          includeWarnings: true,
          requireLineItemReasoning: true,
        },
      },
      priceFileAttachments: [],
    }).join("\n\n")

    const response = await openaiFetch("chat/completions", {
      model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    const rawContent = payload.choices?.[0]?.message?.content || "{}"
    const aiParsed = aiResponseSchema.safeParse(JSON.parse(normalizeJsonFromModel(rawContent)))
    if (!aiParsed.success) {
      const detail = aiParsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
      throw new Error(`KI returnerte et ugyldig kalkyleformat (${detail})`)
    }

    // Samme etterbehandling som den interne motoren (uten prisfiler/lagrede jobber).
    const finalized = finalizeGeneratedOfferLineItems({
      generatedItems: sanitizeUnits(toOfferLineItems(aiParsed.data.lineItems)),
      companyRows: [],
      query,
      subprojects: [],
      companyName: null,
      preserveAiMaterialSelections: true,
    })
    const lineItems = finalized.lineItems
    if (lineItems.length === 0) {
      throw new Error("KI returnerte tomt tilbud")
    }

    const totals = calculateOfferTotals(lineItems)
    const totalInklMvaNok = Math.round(totals.subtotalNok * 1.25)

    const forbehold = Array.from(
      new Set([...aiParsed.data.warnings, ...finalized.warnings].map((w) => w.trim()).filter(Boolean))
    ).slice(0, 5)

    const res = NextResponse.json({
      tilbud: {
        tittel: title,
        innledning: aiParsed.data.summary.slice(0, 600),
        lineItems,
        forbehold,
        totalInklMvaNok,
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
