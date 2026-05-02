import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { matchNorwegianSupplierPrices } from "@/lib/tilbud/supplier-prices"
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
}) {
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
      markupPercent: 18,
      discountPercent: 0,
    }
  })
}

async function runOpenAiAnalysis(input: z.infer<typeof analysisRequestSchema>) {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }

  const supplierMatches = matchNorwegianSupplierPrices({
    description: `${input.title}\n${input.description}\n${input.sourceSummary}`,
    subprojects: input.subprojects,
  })

  const systemPrompt = [
    "Du er en senior kalkulatør i norsk byggenæring.",
    "Lag et komplett og redigerbart tilbudsgrunnlag med linjeelementer.",
    "Du må bruke leverandørpriser i input som grunnlag for en realistisk kalkyle.",
    "Returner KUN gyldig JSON med feltene summary, reasoning, warnings, lineItems.",
    "lineItems må inkludere: title, description, quantity, unit, subproject, supplier, supplierSku, supplierUrl, unitPriceNok, markupPercent, discountPercent.",
    "Bruk norsk språk.",
  ].join(" ")

  const userPrompt = JSON.stringify(
    {
      request: {
        title: input.title,
        description: input.description,
        sourceSummary: input.sourceSummary,
        subprojects: input.subprojects,
      },
      supplierPrices: supplierMatches,
      outputRequirements: {
        minLineItems: 6,
        maxLineItems: 30,
        includeWarnings: true,
      },
    },
    null,
    2
  )

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.2,
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
    model: payload.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
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

    const supplierSnapshots = matchNorwegianSupplierPrices({
      description: `${input.title}\n${input.description}\n${input.sourceSummary}`,
      subprojects: input.subprojects,
    }).map((match) => ({
      supplier: match.supplier,
      product: match.product,
      unit: match.unit,
      unitPriceNok: match.unitPriceNok,
      sourceUrl: match.sourceUrl,
      fetchedAt: generatedAt,
    }))

    let lineItems: OfferLineItem[] = []
    let summary = ""
    let warnings: string[] = []
    let reasoning = ""
    let model = "fallback-rules"

    try {
      const aiResult = await runOpenAiAnalysis(input)
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
      })

      if (!summary) {
        summary =
          "Automatisk kalkyle laget fra tilgjengelige leverandørpriser. Kontroller mengder, delprosjekt-fordeling og påslag før sending."
      }
    }

    const totals = calculateOfferTotals(lineItems)

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
