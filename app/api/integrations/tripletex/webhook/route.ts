import crypto from "crypto"
import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { decryptSecret } from "@/lib/integrations/tripletex/crypto"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"

function verifySignature(rawBody: string, secret: string, signature: string | null) {
  if (!secret) return false
  if (!signature) return false
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
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

    const { data: eventRow, error: insertError } = await admin
      .from("integration_webhook_events")
      .insert({
        provider: "tripletex",
        company_id: companyId || null,
        event_type: eventType,
        external_event_id: externalEventId,
        payload,
        signature_valid: signatureValid,
        process_status: "pending",
      })
      .select("id")
      .maybeSingle()

    if (insertError && insertError.code !== "23505") {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    if (!signatureValid && companyId) {
      await admin
        .from("integration_webhook_events")
        .update({ process_status: "failed", error_message: "Invalid signature", processed_at: new Date().toISOString() })
        .eq("id", eventRow?.id)

      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 })
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
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
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
