import { NextResponse } from "next/server"

import { getDocusignAuthContext } from "@/lib/integrations/docusign/client"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { createClient } from "@/lib/supabase/server"

type ContractStatus = "completed" | "declined" | "voided"
type StoredContractStatus = "draft" | "sent" | "delivered" | "completed" | "declined" | "voided" | "error"

type StoredContract = {
  provider: "docusign"
  status: StoredContractStatus
  envelopeId?: string
  externalUrl?: string
  sentAt?: string
  signedAt?: string
  lastError?: string
  updatedAt?: string
}

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  return { supabase, companyId: userRow.company_id, userId: user.id }
}

function contractActivityEvent(status: ContractStatus | StoredContractStatus) {
  if (status === "completed") return OFFER_ACTIVITY.CONTRACT_COMPLETED
  if (status === "declined") return OFFER_ACTIVITY.CONTRACT_DECLINED
  if (status === "voided") return OFFER_ACTIVITY.CONTRACT_VOIDED
  return null
}

function contractActivityTitle(status: ContractStatus | StoredContractStatus) {
  if (status === "completed") return "Kontrakt signert"
  if (status === "declined") return "Kontrakt avslått"
  if (status === "voided") return "Kontrakt annullert"
  return "Kontraktstatus oppdatert"
}

function patchContract(analysisResult: unknown, status: ContractStatus) {
  const base = analysisResult && typeof analysisResult === "object" ? { ...(analysisResult as Record<string, unknown>) } : {}
  const currentContract =
    base.contract && typeof base.contract === "object" ? { ...(base.contract as Record<string, unknown>) } : {}

  const now = new Date().toISOString()
  const next = {
    ...currentContract,
    provider: "docusign",
    status,
    signedAt: status === "completed" ? now : currentContract.signedAt,
    updatedAt: now,
  }

  return {
    ...base,
    contract: next,
  }
}

function readContract(analysisResult: unknown): StoredContract | null {
  if (!analysisResult || typeof analysisResult !== "object") return null
  const contract = (analysisResult as Record<string, unknown>).contract
  if (!contract || typeof contract !== "object") return null

  const row = contract as Record<string, unknown>
  const rawStatus = String(row.status || "draft")
  const status: StoredContractStatus =
    rawStatus === "sent" ||
    rawStatus === "delivered" ||
    rawStatus === "completed" ||
    rawStatus === "declined" ||
    rawStatus === "voided" ||
    rawStatus === "error"
      ? rawStatus
      : "draft"

  return {
    provider: "docusign",
    status,
    envelopeId: row.envelopeId ? String(row.envelopeId) : undefined,
    externalUrl: row.externalUrl ? String(row.externalUrl) : undefined,
    sentAt: row.sentAt ? String(row.sentAt) : undefined,
    signedAt: row.signedAt ? String(row.signedAt) : undefined,
    lastError: row.lastError ? String(row.lastError) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
  }
}

function isTerminalStatus(status: StoredContractStatus) {
  return status === "completed" || status === "declined" || status === "voided"
}

function mapEnvelopeStatus(raw: string): StoredContractStatus {
  const value = raw.toLowerCase()
  if (value === "completed") return "completed"
  if (value === "declined") return "declined"
  if (value === "voided") return "voided"
  if (value === "delivered") return "delivered"
  if (value === "sent") return "sent"
  if (value === "created") return "draft"
  return "error"
}

function mergeContract(analysisResult: unknown, contract: StoredContract) {
  const base = analysisResult && typeof analysisResult === "object" ? { ...(analysisResult as Record<string, unknown>) } : {}
  return {
    ...base,
    contract,
  }
}

async function refreshContractFromDocusign(contract: StoredContract) {
  if (!contract.envelopeId || isTerminalStatus(contract.status)) {
    return contract
  }

  const auth = await getDocusignAuthContext()
  const response = await fetch(
    `${auth.baseUri}/restapi/v2.1/accounts/${auth.accountId}/envelopes/${contract.envelopeId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  )

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error_description === "string"
        ? payload.error_description
        : "Kunne ikke hente DocuSign status"

    return {
      ...contract,
      lastError: reason,
      updatedAt: new Date().toISOString(),
    }
  }

  const mappedStatus = mapEnvelopeStatus(String(payload?.status || ""))
  const completedAt =
    typeof payload?.completedDateTime === "string" && payload.completedDateTime
      ? String(payload.completedDateTime)
      : mappedStatus === "completed"
      ? new Date().toISOString()
      : contract.signedAt

  return {
    ...contract,
    status: mappedStatus,
    signedAt: completedAt || undefined,
    sentAt: contract.sentAt || (mappedStatus === "sent" || mappedStatus === "delivered" || mappedStatus === "completed" ? new Date().toISOString() : undefined),
    lastError: mappedStatus === "error" ? contract.lastError || "Ukjent DocuSign-status" : undefined,
    updatedAt: new Date().toISOString(),
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params

  const { data: offer } = await ctx.supabase
    .from("offers")
    .select("analysis_result, status")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  const currentContract = readContract(offer.analysis_result)
  if (!currentContract) {
    return NextResponse.json({ ok: true, contract: null, offerStatus: offer.status })
  }

  let refreshed = currentContract
  try {
    refreshed = await refreshContractFromDocusign(currentContract)
  } catch (error) {
    refreshed = {
      ...currentContract,
      lastError: error instanceof Error ? error.message : "Kunne ikke oppdatere kontraktstatus",
      updatedAt: new Date().toISOString(),
    }
  }

  const changed = JSON.stringify(refreshed) !== JSON.stringify(currentContract)
  const shouldAcceptOffer = refreshed.status === "completed" && offer.status !== "accepted"

  if (changed || shouldAcceptOffer) {
    const updateRow: Record<string, unknown> = {
      analysis_result: mergeContract(offer.analysis_result, refreshed),
      updated_at: new Date().toISOString(),
    }
    if (shouldAcceptOffer) {
      updateRow.status = "accepted"
    }

    await ctx.supabase
      .from("offers")
      .update(updateRow)
      .eq("id", id)
      .eq("company_id", ctx.companyId)

    const activityEvent = contractActivityEvent(refreshed.status)
    if (activityEvent && refreshed.status !== currentContract.status) {
      await logOfferActivity({
        offerId: id,
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        eventType: activityEvent,
        title: contractActivityTitle(refreshed.status),
        metadata: { envelopeId: refreshed.envelopeId, status: refreshed.status },
      })
    }
  }

  return NextResponse.json({
    ok: true,
    contract: refreshed,
    offerStatus: shouldAcceptOffer ? "accepted" : offer.status,
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params
  const body = (await request.json()) as { status?: ContractStatus }

  if (!body.status || !["completed", "declined", "voided"].includes(body.status)) {
    return NextResponse.json({ error: "Ugyldig kontraktstatus" }, { status: 400 })
  }

  const { data: offer } = await ctx.supabase
    .from("offers")
    .select("analysis_result")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  const updatedAnalysis = patchContract(offer.analysis_result, body.status)

  const { data, error } = await ctx.supabase
    .from("offers")
    .update({ analysis_result: updatedAnalysis, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .select("analysis_result")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Kunne ikke oppdatere" }, { status: 400 })
  }

  const activityEvent = contractActivityEvent(body.status)
  if (activityEvent) {
    await logOfferActivity({
      offerId: id,
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      eventType: activityEvent,
      title: contractActivityTitle(body.status),
      metadata: { status: body.status, source: "manual" },
    })
  }

  const contract = (data.analysis_result as Record<string, unknown>)?.contract || null
  return NextResponse.json({ ok: true, contract })
}
