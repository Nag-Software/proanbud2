import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyAttioSignature } from "@/lib/attio/signatur"
import { isAttioEnabled } from "@/lib/attio/sync"
import { handleAttioEvent, loadWebhookSecret, type AttioEvent } from "@/lib/attio/webhook"

// Attio gir opp etter fem sekunder. Én hendelse er ett oppslag mot Attio og
// noen få skrivinger her — godt innenfor.
export const maxDuration = 30

/**
 * Webhook fra Attio: flyttede og slettede deals, fullførte oppgaver.
 *
 * Signaturen (HMAC-SHA256 av råteksten) sjekkes før noe annet. Hemmeligheten
 * lagres kryptert når oppsettet lager webhooken.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()

  const admin = createAdminClient()
  const secret = await loadWebhookSecret(admin)
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Attio-webhooken er ikke satt opp" }, { status: 503 })
  }

  const signature = request.headers.get("attio-signature") ?? request.headers.get("x-attio-signature")
  if (!verifyAttioSignature(rawBody, signature, secret)) {
    return NextResponse.json({ ok: false, error: "Ugyldig signatur" }, { status: 401 })
  }

  // Skrudd av: svar 200, så Attio ikke markerer webhooken som degradert.
  if (!isAttioEnabled()) {
    return NextResponse.json({ ok: true, ignored: "Attio-synk er av" })
  }

  let payload: { events?: AttioEvent[] }
  try {
    payload = JSON.parse(rawBody) as { events?: AttioEvent[] }
  } catch {
    return NextResponse.json({ ok: false, error: "Ugyldig JSON" }, { status: 400 })
  }

  const results: string[] = []
  let retry = false
  for (const event of payload.events ?? []) {
    const outcome = await handleAttioEvent(event)
    results.push(outcome.result)
    retry ||= outcome.retry
  }

  // Noe forbigående feilet: 503 får Attio til å prøve igjen senere.
  return NextResponse.json({ ok: !retry, results }, { status: retry ? 503 : 200 })
}
