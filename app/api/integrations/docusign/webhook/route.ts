import crypto from "crypto"
import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"

type DocusignEnvelopeEvent = {
  envelopeId: string | null
  status: "sent" | "delivered" | "completed" | "declined" | "voided" | "error"
  eventId: string
  companyId?: string | null
  offerId?: string | null
}

function verifyDocusignSignature(rawBody: string, secret: string, signature: string | null) {
  if (!secret || !signature) return false
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64")
  const normalizedSignature = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature
  const left = Buffer.from(digest)
  const right = Buffer.from(normalizedSignature)
  if (left.length !== right.length) {
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

function toStatus(value: string | null): DocusignEnvelopeEvent["status"] {
  const normalized = String(value || "").toLowerCase()
  if (normalized === "sent") return "sent"
  if (normalized === "delivered") return "delivered"
  if (normalized === "completed") return "completed"
  if (normalized === "declined") return "declined"
  if (normalized === "voided") return "voided"
  return "error"
}

function readTextCustomField(
  fields: unknown,
  key: string
): string | null {
  if (!fields || typeof fields !== "object") return null
  const textFields = (fields as Record<string, unknown>).textCustomFields
  if (!Array.isArray(textFields)) return null

  const match = textFields.find((field) => {
    if (!field || typeof field !== "object") return false
    const row = field as Record<string, unknown>
    return String(row.name || "").toLowerCase() === key.toLowerCase()
  }) as Record<string, unknown> | undefined

  if (!match) return null
  const value = match.value
  return typeof value === "string" ? value : null
}

function parseJsonPayload(payload: unknown): DocusignEnvelopeEvent {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}

  const envelopeId =
    typeof root.envelopeId === "string"
      ? root.envelopeId
      : typeof root.envelope_id === "string"
      ? root.envelope_id
      : null

  const statusRaw =
    typeof root.status === "string"
      ? root.status
      : typeof root.envelopeStatus === "string"
      ? root.envelopeStatus
      : typeof root.envelope_status === "string"
      ? root.envelope_status
      : null

  const customFields = root.customFields || root.custom_fields
  const companyId = readTextCustomField(customFields, "companyId")
  const offerId = readTextCustomField(customFields, "offerId")

  const eventId =
    typeof root.eventId === "string"
      ? root.eventId
      : typeof root.event_id === "string"
      ? root.event_id
      : envelopeId
      ? `${envelopeId}:${Date.now()}`
      : crypto.randomUUID()

  return {
    envelopeId,
    status: toStatus(statusRaw),
    eventId,
    companyId,
    offerId,
  }
}

function firstMatch(raw: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function parseXmlPayload(rawBody: string): DocusignEnvelopeEvent {
  const envelopeId = firstMatch(rawBody, [
    /<EnvelopeID>([^<]+)<\/EnvelopeID>/i,
    /<EnvelopeId>([^<]+)<\/EnvelopeId>/i,
  ])

  const statusRaw = firstMatch(rawBody, [
    /<Status>([^<]+)<\/Status>/i,
    /<EnvelopeStatus>([^<]+)<\/EnvelopeStatus>/i,
  ])

  const companyId = firstMatch(rawBody, [
    /<Name>companyId<\/Name>\s*<Value>([^<]+)<\/Value>/i,
  ])

  const offerId = firstMatch(rawBody, [
    /<Name>offerId<\/Name>\s*<Value>([^<]+)<\/Value>/i,
  ])

  return {
    envelopeId,
    status: toStatus(statusRaw),
    eventId: envelopeId ? `${envelopeId}:${Date.now()}` : crypto.randomUUID(),
    companyId,
    offerId,
  }
}

export async function POST(request: Request) {
  const admin = createAdminClient()

  try {
    const rawBody = await request.text()
    const contentType = request.headers.get("content-type") || ""
    const signatureHeader = request.headers.get("x-docusign-signature-1")
    const secret = process.env.DOCUSIGN_CONNECT_HMAC_KEY || ""
    // Fail closed: a missing HMAC key is misconfiguration, not a reason to skip
    // verification (otherwise an unauthenticated POST could flip offer status).
    if (!secret) {
      return NextResponse.json({ ok: false, error: "DocuSign webhook not configured" }, { status: 500 })
    }

    const signatureValid = verifyDocusignSignature(rawBody, secret, signatureHeader)
    if (!signatureValid) {
      return NextResponse.json({ ok: false, error: "Invalid DocuSign signature" }, { status: 401 })
    }

    const event = contentType.includes("xml")
      ? parseXmlPayload(rawBody)
      : parseJsonPayload(rawBody ? JSON.parse(rawBody) : {})

    let companyId = event.companyId || null
    let offerId = event.offerId || null

    if ((!companyId || !offerId) && event.envelopeId) {
      const { data: matchedContract } = await admin
        .from("contracts")
        .select("offer_id, company_id")
        .eq("signing_external_id", event.envelopeId)
        .limit(1)
        .maybeSingle()

      if (matchedContract) {
        companyId = matchedContract.company_id
        offerId = matchedContract.offer_id
      } else {
        const { data: matchedOffer } = await admin
          .from("offers")
          .select("id, company_id, analysis_result")
          .contains("analysis_result", { contract: { envelopeId: event.envelopeId } })
          .limit(1)
          .maybeSingle()

        if (matchedOffer) {
          companyId = matchedOffer.company_id
          offerId = matchedOffer.id
        }
      }
    }

    const { data: eventRow } = await admin
      .from("integration_webhook_events")
      .insert({
        provider: "docusign",
        company_id: companyId,
        event_type: `envelope.${event.status}`,
        external_event_id: event.eventId,
        payload: contentType.includes("xml") ? { raw: rawBody } : (rawBody ? JSON.parse(rawBody) : {}),
        signature_valid: secret ? signatureValid : null,
        process_status: "pending",
      })
      .select("id")
      .maybeSingle()

    if (!offerId || !companyId) {
      if (eventRow?.id) {
        await admin
          .from("integration_webhook_events")
          .update({
            process_status: "failed",
            error_message: "Could not map webhook to offer/company",
            processed_at: new Date().toISOString(),
          })
          .eq("id", eventRow.id)
      }

      return NextResponse.json({ ok: true, mapped: false })
    }

    const { data: offer } = await admin
      .from("offers")
      .select("status, analysis_result, customer_id, project_id")
      .eq("id", offerId)
      .eq("company_id", companyId)
      .maybeSingle()

    if (!offer) {
      if (eventRow?.id) {
        await admin
          .from("integration_webhook_events")
          .update({ process_status: "failed", error_message: "Offer not found", processed_at: new Date().toISOString() })
          .eq("id", eventRow.id)
      }
      return NextResponse.json({ ok: true, mapped: false })
    }

    const now = new Date().toISOString()
    const offerStatus =
      event.status === "completed"
        ? "accepted"
        : event.status === "declined" || event.status === "voided"
        ? "rejected"
        : offer.status

    await admin
      .from("offers")
      .update({
        status: offerStatus,
        updated_at: now,
      })
      .eq("id", offerId)
      .eq("company_id", companyId)

    if (eventRow?.id) {
      await admin
        .from("integration_webhook_events")
        .update({ process_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", eventRow.id)
    }

    return NextResponse.json({ ok: true, mapped: true, offerId, companyId, status: event.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
