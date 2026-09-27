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
  AI_EDIT_SYSTEM_PROMPT,
  buildAiEditUserMessage,
  normalizeExistingLineItems,
  proposeOfferEdit,
  type AiEditProposal,
  type ChatMessage,
  type ModelReply,
} from "@/lib/tilbud/ai-edit-proposal"
import {
  calculateOfferTotals,
  type OfferLineItem,
} from "@/lib/tilbud/types"
import {
  describeOfferLineItemChanges,
  diffOfferLineItems,
} from "@/lib/tilbud/offer-line-item-diff"
import { isHourUnit } from "@/lib/job-costing/calc"
import {
  fetchCompanyHourlyRates,
  formatHourlyRatesForPrompt,
  normalizeLaborLineItem,
  type CompanyHourlyRate,
} from "@/lib/tilbud/labor"

const requestSchema = z.object({
  instruction: z.string().trim().min(3).max(2_000),
  generationId: z.string().uuid(),
})

type OfferRow = {
  id: string
  title: string | null
  description: string | null
  source_summary: string | null
  status: string | null
  line_items: unknown
}

function toOfferLineItems(
  proposed: AiEditProposal["lineItems"],
  existing: OfferLineItem[],
  hourlyRates: CompanyHourlyRate[]
): OfferLineItem[] {
  const existingById = new Map(existing.map((item) => [item.id, item]))

  return proposed.map((item) => {
    const previous = item.id ? existingById.get(item.id) : undefined
    const merged: OfferLineItem = {
      ...previous,
      ...item,
      id: previous?.id || crypto.randomUUID(),
      priceSource: item.priceSource ?? previous?.priceSource,
      incomeAccountCategory:
        item.incomeAccountCategory ?? previous?.incomeAccountCategory,
    }
    // Nye arbeidslinjer får bedriftens timepris. Eksisterende linjer røres ikke —
    // der kan håndverkeren ha satt prisen selv.
    return !previous && isHourUnit(merged.unit)
      ? normalizeLaborLineItem(merged, hourlyRates)
      : merged
  })
}

export const maxDuration = 120

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Ti sekunder margin til måling og svar etter at KI-en er ferdig.
  const deadline = Date.now() + (maxDuration - 10) * 1_000
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
    const hourlyRates = await fetchCompanyHourlyRates(supabase, subscription.context.companyId)
    const model = process.env.OPENAI_MODEL || "gpt-5.2-mini"
    const callModel = async (
      messages: ChatMessage[],
      timeoutMs: number
    ): Promise<ModelReply> => {
      const response = await openaiFetch(
        "chat/completions",
        { model, response_format: { type: "json_object" }, messages },
        // Reparasjonskallet får resten av tidsbudsjettet og ingen nye forsøk.
        { timeoutMs, retries: messages.length > 2 ? 0 : 1 }
      )
      const payload = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null }
          finish_reason?: string
        }>
        model?: string
      }
      return {
        content: payload.choices?.[0]?.message?.content ?? "",
        model: payload.model,
        finishReason: payload.choices?.[0]?.finish_reason,
      }
    }

    const result = await proposeOfferEdit({
      deadline,
      callModel,
      messages: [
        { role: "system", content: AI_EDIT_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildAiEditUserMessage({
            instruction: body.data.instruction,
            currentOffer: {
              title: currentOffer.title || "Uten tittel",
              description: currentOffer.description || "",
              sourceSummary: currentOffer.source_summary || "",
              lineItems: currentLineItems,
            },
            timepriser: formatHourlyRatesForPrompt(hourlyRates),
          }),
        },
      ],
    })

    if (!result.ok) {
      // Loggen sa før bare «ugyldig endringsforslag». Nå står det hvilket felt
      // modellen bommet på, og med hva — det er det som trengs for å rette.
      await logServerError({
        message: "AI offer edit failed",
        error: new Error("KI returnerte et ugyldig endringsforslag"),
        source: "api",
        route: "POST /api/offers/[id]/ai-edit",
        statusCode: 422,
        level: "warning",
        companyId: subscription.context.companyId,
        userId: subscription.context.userId,
        context: {
          offerId: id,
          model: result.reply.model || model,
          finishReason: result.reply.finishReason,
          repaired: result.repaired,
          repairError: result.repairError,
          issues: result.issues,
        },
      })

      return NextResponse.json(
        {
          error:
            "KI klarte ikke å lage et gyldig forslag. Prøv å formulere endringen litt annerledes.",
        },
        { status: 422 }
      )
    }

    const proposal = result.proposal
    const lineItems = toOfferLineItems(
      proposal.lineItems,
      currentLineItems,
      hourlyRates
    )
    const changes = [
      ...(proposal.title !== (currentOffer.title || "Uten tittel")
        ? ["Endret tilbudstittel"]
        : []),
      ...(proposal.description !== (currentOffer.description || "")
        ? ["Endret tilbudsbeskrivelsen"]
        : []),
      ...(proposal.sourceSummary !== (currentOffer.source_summary || "")
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
        model: result.reply.model || model,
        mode: "edit",
        repaired: result.repaired,
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
        ...proposal,
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
