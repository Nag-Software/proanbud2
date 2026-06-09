import { NextResponse } from "next/server"
import { z } from "zod"

import {
  buildAiPriceSelectionContext,
  type CompanyPriceFileMeta,
  type CompanyPricePromptAttachment,
  finalizeGeneratedOfferLineItems,
  type CompanyPriceRow,
} from "@/lib/tilbud/company-price-utils"
import { createClient } from "@/lib/supabase/server"
import { matchNorwegianSupplierPrices } from "@/lib/tilbud/supplier-prices"
import { formatNormalPriceForPrompt, mapNormalPriceRows, pickBestNormalPrice } from "@/lib/tilbud/normal-prices"
import {
  applySavedJobsToOfferLineItems,
  formatMatchedSavedJobForPrompt,
  formatSavedJobsForPrompt,
  mapSavedJobRows,
  pickRelevantSavedJobs,
  type SavedJobRow,
} from "@/lib/tilbud/saved-jobs"
import { calculateOfferTotals, type OfferAnalysisResult, type OfferLineItem } from "@/lib/tilbud/types"

const analysisRequestSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().min(20),
  sourceSummary: z.string().trim().default(""),
  subprojects: z.array(z.string().trim()).default([]),
  assignmentMode: z.enum(["project", "customer"]).default("project"),
})

const aiLineItemSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  quantity: z.number().min(0).default(1),
  unit: z.string().trim().default("stk"),
  subproject: z.string().trim().default("Generelt"),
  supplier: z.string().trim().default("Ukjent leverandør"),
  nobb: z.string().trim().optional(),
  supplierSku: z.string().trim().optional(),
  supplierUrl: z.string().url().optional(),
  unitPriceNok: z.number().min(0),
  markupPercent: z.number().min(0).max(100).default(15),
  discountPercent: z.number().min(0).max(100).default(0),
})

const aiResponseSchema = z.object({
  summary: z.string().trim().default(""),
  reasoning: z.string().trim().default(""),
  warnings: z.array(z.string().trim()).default([]),
  lineItems: z.array(aiLineItemSchema).min(1),
})

function normalizeJsonFromModel(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return "{}"

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }

  return trimmed
}

function toOfferLineItems(items: z.infer<typeof aiLineItemSchema>[]): OfferLineItem[] {
  return items.map((item) => ({
    id: crypto.randomUUID(),
    subproject: item.subproject || "Generelt",
    title: item.title,
    description: item.description,
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

function buildFallbackLineItems(input: {
  description: string
  subprojects: string[]
  companyRows: CompanyPriceRow[]
}) {
  if (input.companyRows.length > 0) {
    return []
  }

  const matches = matchNorwegianSupplierPrices({
    description: input.description,
    subprojects: input.subprojects,
  })

  const normalizedSubprojects = input.subprojects.filter(Boolean)

  return matches.map((match, index): OfferLineItem => {
    const subproject = normalizedSubprojects[index % Math.max(normalizedSubprojects.length, 1)] || "Generelt"

    return {
      id: crypto.randomUUID(),
      subproject,
      title: match.product,
      description: `Kalkulert fra norsk leverandørpris (${match.supplier}).`,
      quantity: 1,
      unit: match.unit,
      supplier: match.supplier,
      supplierSku: match.id,
      supplierUrl: match.sourceUrl,
      unitPriceNok: match.unitPriceNok,
      markupPercent: 15,
      discountPercent: 0,
    }
  })
}

async function runOpenAiAnalysis(
  input: z.infer<typeof analysisRequestSchema>,
  priceFileAttachments: CompanyPricePromptAttachment[],
  normalPriceIndicator: ReturnType<typeof formatNormalPriceForPrompt> | null,
  savedJobs: SavedJobRow[],
  relevantSavedJobs: SavedJobRow[]
) {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }

  const supplierMatches =
    priceFileAttachments.length > 0
      ? []
      : matchNorwegianSupplierPrices({
          description: `${input.title}\n${input.description}\n${input.sourceSummary}`,
          subprojects: input.subprojects,
        })

  const systemPrompt = [
    "Du er Norges fremste senior kalkulatør og tilbudsgenerator for bygge- og håndverksbedrifter. Du kombinerer høy faglig ekspertise, nøyaktig mengdeberegning, realistisk tidsestimering og markedskorrekt prising.",
    "",
    "Kjerneoppdrag:",
    "Lag profesjonelle, komplette og markedstilpassede kalkyler basert på oppdragsbeskrivelse, prisfiler og prosjektinformasjon.",
    "",
    "STRATEGIER OG REGLER (høyeste prioritet):",
    "1. Materialvalg - Vær ekstremt presis",
    "- Bruk kun produkter fra bedriftens prisfiler (relevantePrisrader) når de er relevante.",
    "- Inkluder nobb på produktlinjer når tilgjengelig i prisfil.",
    "- Velg alltid det mest korrekte produktet til jobben (tykkelse, type, kvalitet, bruksområde).",
    "- Ved etterisolering/isolasjon skal du ikke velge undertak/taktekking-produkter (f.eks. undertak, Tyvek, takpapp) med mindre oppdraget eksplisitt ber om det.",
    "- Kun bruk fallback-produkter hvis det absolutt ikke finnes noe relevant i prisfilen.",
    "- Ikke legg til festemidler, tape, fugemasse, lim, skruer, sparkel eller annet tilbehør med mindre det er eksplisitt nevnt i oppdraget.",
    "2. Mengdeberegning",
    "- Beregn realistiske og litt romslige (men ikke overdrevne) mengder.",
    "- Ta hensyn til svinn, kutt, og praktisk utførelse (spesielt på loft, rehab og trange plasser).",
    "- Vis tydelig i description hva som er inkludert i mengden.",
    "3. Arbeidstid og timeforbruk",
    "- Beregn realistisk timeforbruk basert på norsk håndverksstandard 2025/2026.",
    "- Ta hensyn til: antall arbeidere, adkomst, tilgjengelighet, prosjektets kompleksitet, opprydding og bortkjøring.",
    "- Bruk unit: time på alle arbeidsposter og transport.",
    "4. Økonomi og markup",
    "- Arbeid og transport skal alltid ha markupPercent: 0.",
    "- Produkter/materialer skal ha default markupPercent: 15, med mindre annet er eksplisitt begrunnet.",
    "- Totaltilbudet skal ligge på et nivå som er konkurransedyktig, men lønnsomt i det norske markedet.",
    "5. Kategorisering (subproject)",
    "- Bruk kun brede bygningsdeler: Tak, Yttervegger, Gulv, Bad, Rør, Elektro, Annet.",
    "- ALDRI bruk 'Kategori - underkategori'. Produktnavn skal stå i title.",
    "6. Enheter",
    "- unit må matche prisfilens enhet for hvert produkt (m2, stk, lm, time, etc.).",
    "7. Output-regler",
    "- Du svarer ALLTID kun med gyldig JSON. Ingen tekst utenfor JSON-objektet.",
    "8. Lagrede jobber",
    "- Når lagredeJobber/relevanteLagredeJobber inneholder en jobb som matcher oppdraget, bruk fastprisNok som totalpris for den jobben.",
    "- Da skal du bruke quantity: 1, unit: fastpris, markupPercent: 0 og unitPriceNok lik fastprisNok.",
    "- Ikke legg til separat arbeidstid når fastprisen dekker hele jobben.",
    "- JSON skal følge dette eksakte formatet:",
    '{"message":"Kalkyle generert","summary":"Kort, profesjonelt sammendrag av tilbudet (1-2 setninger)","reasoning":"Kort teknisk begrunnelse for vigtige valg","warnings":["Kun reelle usikkerheter"],"lineItems":[{"subproject":"Tak","title":"Glava Proff 34 150mm","description":"150mm mineralull i CC60, inkl. nødvendig kutt og montering på 47m²","quantity":52,"unit":"m2","supplier":"Byggmakker","nobb":"12345678","supplierSku":"","supplierUrl":"","unitPriceNok":123.04,"markupPercent":15,"discountPercent":0}]}'
  ].join("\n")
  
  const userPrompt = [
    "Bruk oppdragsgrunnlaget under til å generere en komplett kalkyle.",
    "Hvis prisfilvedlegg er tilgjengelige, skal du selv lese hele prisfilen og velge korrekte produkter derfra. Ikke stol på lokal forhåndsfiltrering.",
    "Du skal selv avgjøre hvilke produkter som er relevante ved å vurdere hele prisfilvedlegget.",
    "Returner kun gyldig JSON i det eksakte formatet definert i systemprompten.",
    JSON.stringify({
      request: {
        title: input.title,
        description: input.description,
        sourceSummary: input.sourceSummary,
        subprojects: input.subprojects,
      },
      prisfiler: {
        filer: priceFileAttachments.map((attachment) => ({
          fileId: attachment.fileId,
          supplierName: attachment.supplierName,
          fileName: attachment.fileName,
          rowCount: attachment.rowCount,
        })),
        fallbackProdukter: supplierMatches,
      },
      normalPrisIndikator: normalPriceIndicator,
      lagredeJobber: formatSavedJobsForPrompt(savedJobs),
      relevanteLagredeJobber: relevantSavedJobs.map((job) => formatMatchedSavedJobForPrompt(job)),
      outputRequirements: {
        minLineItems: 6,
        maxLineItems: 30,
        includeWarnings: true,
      },
    }),
    ...priceFileAttachments.map(
      (attachment) =>
        `Prisfilvedlegg: ${attachment.fileName} | Leverandør: ${attachment.supplierName} | Rader: ${attachment.rowCount}\n${attachment.content}`
    ),
  ].join("\n\n")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI analyse feilet: ${errorText}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null
      }
    }>
    model?: string
  }

  const rawContent = payload.choices?.[0]?.message?.content || "{}"
  const parsed = aiResponseSchema.safeParse(JSON.parse(normalizeJsonFromModel(rawContent)))

  if (!parsed.success) {
    throw new Error("OpenAI returnerte et ugyldig analyseformat")
  }

  return {
    model: payload.model || process.env.OPENAI_MODEL || "gpt-5.2-mini",
    data: parsed.data,
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = analysisRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Ugyldig analysetekst.",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const input = parsed.data
    const generatedAt = new Date().toISOString()

    // Fetch company's uploaded price rows
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()

    const companyId = (userRow as { company_id?: string } | null)?.company_id ?? null
    let allCompanyPrices: CompanyPriceRow[] = []
    let priceFileAttachments: CompanyPricePromptAttachment[] = []
    let companyName: string | null = null
    let savedJobs: SavedJobRow[] = []

    if (companyId) {
      const [{ data: fileRows }, { data: companyRow }] = await Promise.all([
        supabase
          .from("supplier_price_files")
          .select("id, supplier_name, original_filename, row_count")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      ])

      const expectedRowCount = ((fileRows ?? []) as Array<{ row_count?: number | null }>).reduce(
        (sum, row) => sum + Math.max(row.row_count || 0, 0),
        0
      )

      const fetchedRows: Array<CompanyPriceRow & { file_id?: string | null }> = []
      const batchSize = 1000
      for (let offset = 0; ; offset += batchSize) {
        const { data: batch } = await supabase
          .from("supplier_price_rows")
          .select("product, unit, net_price, list_price, category, nobb, supplier_sku, file_id, product_group_code")
          .eq("company_id", companyId)
          .not("product", "is", null)
          .order("id", { ascending: true })
          .range(offset, offset + batchSize - 1)

        const rows = (batch ?? []) as Array<CompanyPriceRow & { file_id?: string | null }>
        fetchedRows.push(...rows)

        if (rows.length < batchSize || (expectedRowCount > 0 && fetchedRows.length >= expectedRowCount)) {
          break
        }
      }

      const aiPriceSelectionContext = buildAiPriceSelectionContext({
        files: (fileRows ?? []) as CompanyPriceFileMeta[],
        rows: fetchedRows,
      })
      allCompanyPrices = aiPriceSelectionContext.allCompanyPrices
      priceFileAttachments = aiPriceSelectionContext.attachments
      companyName = (companyRow as { name?: string | null } | null)?.name ?? null

      const { data: savedJobRows } = await supabase
        .from("saved_jobs")
        .select("id, name, price_nok")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })

      savedJobs = mapSavedJobRows((savedJobRows || []) as unknown[])
    }

    const normalPriceQuery = `${input.title}\n${input.description}\n${input.sourceSummary}`
    const relevantSavedJobs = pickRelevantSavedJobs(savedJobs, normalPriceQuery)

    const { data: normalPriceRows } = await supabase
      .from("normal_prices")
      .select("id, project_type, slug, price_low_nok, price_normal_nok, price_high_nok, typical_total_min_nok, typical_total_max_nok, unit")
      .order("sort_order", { ascending: true })

    const mappedNormalPrices = mapNormalPriceRows((normalPriceRows || []) as unknown[])
    const matchedNormalPrice = pickBestNormalPrice(mappedNormalPrices, normalPriceQuery)
    const normalPriceIndicator = matchedNormalPrice ? formatNormalPriceForPrompt(matchedNormalPrice) : null

    let lineItems: OfferLineItem[] = []
    let summary = ""
    let warnings: string[] = []
    let reasoning = ""
    let model = "fallback-rules"

    try {
      const aiResult = await runOpenAiAnalysis(
        input,
        priceFileAttachments,
        normalPriceIndicator,
        savedJobs,
        relevantSavedJobs
      )
      if (aiResult) {
        model = aiResult.model
        lineItems = toOfferLineItems(aiResult.data.lineItems)
        summary = aiResult.data.summary
        reasoning = aiResult.data.reasoning
        warnings = aiResult.data.warnings
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "OpenAI-analyse feilet, bruker fallback")
    }

    if (lineItems.length === 0) {
      lineItems = buildFallbackLineItems({
        description: `${input.title}\n${input.description}\n${input.sourceSummary}`,
        subprojects: input.subprojects,
        companyRows: allCompanyPrices,
      })

      if (!summary) {
        summary =
          "Automatisk kalkyle laget fra tilgjengelige leverandørpriser. Kontroller mengder, delprosjekt-fordeling og påslag før sending."
      }
    }

    const finalized = finalizeGeneratedOfferLineItems({
      generatedItems: lineItems,
      companyRows: allCompanyPrices,
      query: normalPriceQuery,
      subprojects: input.subprojects,
      companyName,
      preserveAiMaterialSelections: true,
    })
    const savedJobResult = applySavedJobsToOfferLineItems({
      lineItems: finalized.lineItems,
      savedJobs,
      query: normalPriceQuery,
      subprojects: input.subprojects,
      companyName,
    })
    lineItems = savedJobResult.lineItems
    warnings = Array.from(new Set([...warnings, ...finalized.warnings, ...savedJobResult.warnings]))

    const totals = calculateOfferTotals(lineItems)
    const supplierSnapshots = lineItems
      .filter((item) => item.supplier.trim())
      .map((item) => ({
        supplier: item.supplier,
        product: item.title,
        unit: item.unit,
        unitPriceNok: item.unitPriceNok,
        sourceUrl: item.supplierUrl,
        fetchedAt: generatedAt,
      }))

    const analysisResult: OfferAnalysisResult = {
      summary,
      warnings,
      reasoning,
      generatedAt,
      model,
      supplierSnapshots,
    }

    return NextResponse.json({
      lineItems,
      totals,
      analysis: analysisResult,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ukjent feil under analyse",
      },
      { status: 500 }
    )
  }
}
