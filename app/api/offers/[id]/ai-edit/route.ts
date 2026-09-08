import { NextResponse } from "next/server"
import { z } from "zod"

import {
  getUsageSummary,
  recordUsageEvent,
  requireActiveSubscription,
} from "@/lib/billing/guards"
import { logServerError } from "@/lib/errors/log"
import { openaiFetch } from "@/lib/llm/openai-fetch"
import { canSendOffers } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"
import {
  calculateOfferTotals,
  type OfferLineItem,
} from "@/lib/tilbud/types"
import {
  describeOfferLineItemChanges,
  diffOfferLineItems,
} from "@/lib/tilbud/offer-line-item-diff"

const requestSchema = z.object({
  instruction: z.string().trim().min(3).max(2_000),
  generationId: z.string().uuid(),
})

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.string().max(max).optional()
  )

const lineItemSchema = z.object({
  id: z.string().optional(),
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
  priceSource: z.enum(["prisfil", "lagret-jobb", "anslag"]).optional(),
  incomeAccountCategory: z
    .enum(["vare_videresalg", "vare_egenprodusert", "tjeneste", "annet"])
    .optional(),
})

const proposalSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(10_000),
  sourceSummary: z.string().max(5_000),
  lineItems: z.array(lineItemSchema).max(100),
})

type OfferRow = {
  id: string
  title: string | null
  description: string | null
  source_summary: string | null
  status: string | null
  line_items: unknown
}

function normalizeJsonFromModel(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
}

function normalizeExistingLineItems(input: unknown): OfferLineItem[] {
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
        incomeAccountCategory: item.incomeAccountCategory,
      }
    })
    .filter((item) => item.title.trim())
}

function toOfferLineItems(
  proposed: z.infer<typeof lineItemSchema>[],
  existing: OfferLineItem[]
): OfferLineItem[] {
  const existingById = new Map(existing.map((item) => [item.id, item]))

  return proposed.map((item) => {
    const previous = item.id ? existingById.get(item.id) : undefined
    return {
      ...previous,
      ...item,
      id: previous?.id || crypto.randomUUID(),
      priceSource: item.priceSource ?? previous?.priceSource,
      incomeAccountCategory:
        item.incomeAccountCategory ?? previous?.incomeAccountCategory,
    }
  })
}

export const maxDuration = 120

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const subscription = await requireActiveSubscription()
  if (!subscription.ok) return subscription.response

  const { id } = await params
  const body = requestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: "Beskriv kort hva du vil endre i tilbudet." },
      { status: 400 }
    )
  }

  try {
    const usage = await getUsageSummary(subscription.context.companyId)
    if ((usage.used ?? 0) >= 1_000) {
      return NextResponse.json(
        { error: "Du har nådd maksgrensen for KI-tilbud denne perioden." },
        { status: 429 }
      )
    }

    const supabase = await createClient()
    const [{ data: userRow }, { data: offer, error: offerError }] =
      await Promise.all([
        supabase
          .from("users")
          .select("role")
          .eq("id", subscription.context.userId)
          .maybeSingle(),
        supabase
          .from("offers")
          .select("id, title, description, source_summary, status, line_items")
          .eq("id", id)
          .eq("company_id", subscription.context.companyId)
          .maybeSingle(),
      ])

    if (!canSendOffers(userRow?.role)) {
      return NextResponse.json(
        { error: "Du har ikke tilgang til å endre tilbud." },
        { status: 403 }
      )
    }

    if (offerError || !offer) {
      return NextResponse.json({ error: "Fant ikke tilbudet." }, { status: 404 })
    }

    const currentOffer = offer as OfferRow
    if (currentOffer.status !== "draft") {
      return NextResponse.json(
        {
          error:
            "Et sendt eller godkjent tilbud kan ikke endres med KI. Opprett et nytt utkast for å endre innholdet.",
        },
        { status: 409 }
      )
    }

    const currentLineItems = normalizeExistingLineItems(currentOffer.line_items)
    const model = process.env.OPENAI_MODEL || "gpt-5.2-mini"
    const response = await openaiFetch(
      "chat/completions",
      {
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Du redigerer norske håndverkertilbud.",
              "Gjør bare endringene brukeren uttrykkelig ber om.",
              "Returner hele tilbudet i gyldig JSON, uten markdown.",
              "Behold alle uendrede felt og linjer nøyaktig.",
              "Behold id på eksisterende linjer. Utelat id bare for nye linjer.",
              "Ikke finn på leverandør, artikkelnummer eller pris.",
              "For en ny linje uten eksplisitt pris, bruk unitPriceNok 0 og priceSource anslag.",
              "Slett aldri en linje med mindre brukeren tydelig ber om det.",
              "Beløp er ekskludert mva. Skriv kort og tydelig norsk.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction: body.data.instruction,
              currentOffer: {
                title: currentOffer.title || "Uten tittel",
                description: currentOffer.description || "",
                sourceSummary: currentOffer.source_summary || "",
                lineItems: currentLineItems,
              },
              requiredResponseShape: {
                summary: "kort oppsummering",
                title: "hele tittelen",
                description: "hele beskrivelsen",
                sourceSummary: "hele kundemeldingen",
                lineItems: "hele listen med tilbudslinjer",
              },
            }),
          },
        ],
      },
      { timeoutMs: 90_000, retries: 1 }
    )

    const openAiPayload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
      model?: string
    }
    const raw = openAiPayload.choices?.[0]?.message?.content || "{}"
    const parsedProposal = proposalSchema.safeParse(
      JSON.parse(normalizeJsonFromModel(raw))
    )

    if (!parsedProposal.success) {
      throw new Error("KI returnerte et ugyldig endringsforslag")
    }

    const lineItems = toOfferLineItems(
      parsedProposal.data.lineItems,
      currentLineItems
    )
    const changes = [
      ...(parsedProposal.data.title !== (currentOffer.title || "Uten tittel")
        ? ["Endret tilbudstittel"]
        : []),
      ...(parsedProposal.data.description !== (currentOffer.description || "")
        ? ["Endret tilbudsbeskrivelsen"]
        : []),
      ...(parsedProposal.data.sourceSummary !==
      (currentOffer.source_summary || "")
        ? ["Endret melding til kunde"]
        : []),
      ...describeOfferLineItemChanges(
        diffOfferLineItems(currentLineItems, lineItems)
      ),
    ]
    const metering = await recordUsageEvent({
      companyId: subscription.context.companyId,
      eventType: "ai_tilbud",
      idempotencyKey: `ai_tilbud_edit:${id}:${body.data.generationId}`,
      metadata: {
        user_id: subscription.context.userId,
        offer_id: id,
        model: openAiPayload.model || model,
        mode: "edit",
      },
    })

    if (changes.length === 0) {
      return NextResponse.json(
        {
          error:
            "KI foreslo ingen faktiske endringer. Prøv en mer konkret instruksjon.",
        },
        { status: 422 }
      )
    }

    return NextResponse.json({
      proposal: {
        ...parsedProposal.data,
        changes,
        lineItems,
        currentTotals: calculateOfferTotals(currentLineItems),
        proposedTotals: calculateOfferTotals(lineItems),
      },
      usage: {
        used: metering.used,
        quotaLimit: metering.quota_limit,
        overage: metering.overage,
      },
    })
  } catch (error) {
    await logServerError({
      message: "AI offer edit failed",
      error,
      source: "api",
      route: "POST /api/offers/[id]/ai-edit",
      statusCode: 500,
      level: "error",
      companyId: subscription.context.companyId,
      userId: subscription.context.userId,
      context: { offerId: id },
    })

    return NextResponse.json(
      { error: "KI klarte ikke å lage et endringsforslag. Prøv igjen." },
      { status: 500 }
    )
  }
}
