import crypto from "crypto"
import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { decryptSecret } from "@/lib/integrations/tripletex/crypto"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"

function verifySignature(rawBody: string, secret: string, signature: string | null) {
  if (!secret) return false
  if (!signature) return false
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"))
  const provided = Buffer.from(signature.trim())
  // timingSafeEqual throws on a length mismatch, and `signature` is attacker-controlled —
  // length-check first so a malformed header is a clean `false` (→ 401), not a thrown 500.
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(expected, provided)
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const payload = rawBody ? JSON.parse(rawBody) : {}

    const companyId = String(payload.companyId || payload.company_id || "")
    const eventType = String(payload.type || payload.eventType || "unknown")
    const externalEventId = String(payload.id || payload.eventId || crypto.randomUUID())

    const admin = createAdminClient()

    let signatureValid = false
    if (companyId) {
      const { data: connection } = await admin
        .from("tripletex_connections")
        .select("webhook_secret_enc")
        .eq("company_id", companyId)
        .maybeSingle()

      const webhookSecret = decryptSecret(connection?.webhook_secret_enc)
      signatureValid = verifySignature(rawBody, webhookSecret, request.headers.get("x-tripletex-signature"))
    }

    // Reject unverified webhooks BEFORE any DB write — no fail-open when companyId
    // or the stored secret is missing (prevents unauthenticated inserts / log spam).
    if (!signatureValid) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 })
    }

    const { data: eventRow, error: insertError } = await admin
      .from("integration_webhook_events")
      .insert({
        provider: "tripletex",
        company_id: companyId,
        event_type: eventType,
        external_event_id: externalEventId,
        payload,
        signature_valid: true,
        process_status: "pending",
      })
      .select("id")
      .maybeSingle()

    if (insertError && insertError.code !== "23505") {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    if (companyId && eventType === "invoice.paid") {
      await enqueueIntegrationJob({
        companyId,
        jobType: "webhook.invoice_paid",
        payload,
        idempotencyKey: `webhook:invoice.paid:${externalEventId}`,
      })
    }

    if (eventRow?.id) {
      await admin
        .from("integration_webhook_events")
        .update({ process_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", eventRow.id)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    // Don't echo internal error text (decrypt/DB messages) to an unauthenticated caller.
    console.error("[tripletex webhook] processing failed", error)
    await logServerError({
      message: "Tripletex webhook processing failed",
      error,
      source: "api",
      route: "POST /api/integrations/tripletex/webhook",
    })
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

export async function GET() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
