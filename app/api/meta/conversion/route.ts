import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"

import { META_PIXEL_ID, hasMetaConsent } from "@/lib/analytics/meta-pixel"
import { CONSENT_COOKIE } from "@/lib/analytics/openai-ads"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

/**
 * Meta Conversions API — serverside-tvilling til `CompleteRegistration` fra
 * lib/analytics/meta-pixel.ts.
 *
 * Nettleser-eventer forsvinner (Safari/ITP, annonseblokkere). Dette kallet går
 * server-til-server, så Meta får registreringen selv når bilde-kallet stoppes.
 * Begge kanaler sender SAMME `event_id`; Meta dedupliserer på eventnavn +
 * event_id, så registreringen telles én gang.
 *
 * Krever innlogget bruker og sender bare `CompleteRegistration` — ruta skal
 * ikke kunne brukes som åpen event-proxy mot pixelen vår.
 *
 * Best-effort: svarer 200 også når Meta avviser, slik at måling aldri viser
 * seg som en feil for brukeren. Avvisningen logges til /sjefen/feil.
 */

const EVENT_NAME = "CompleteRegistration"
/** Overstyrbar så en versjon som utgår kan bumpes uten kodeendring. */
const API_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || "v24.0"

/**
 * E-posthashing gir klart bedre matching, men er PII — og analytics-laget vårt
 * har en «aldri PII»-linje. Av som standard; skru på med
 * META_CAPI_SEND_EMAIL_HASH=on (samme mønster som OPENAI_ADS_SEND_EMAIL_HASH).
 */
const SEND_EMAIL_HASH =
  process.env.META_CAPI_SEND_EMAIL_HASH?.trim().toLowerCase() === "on"

const bodySchema = z.object({
  eventId: z.string().regex(/^reg-[0-9a-f-]{36}$/i),
  sourceUrl: z.string().url().max(2048).optional(),
})

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  if (!match) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export async function POST(request: Request) {
  const accessToken = process.env.META_CONVERSION_API_KEY?.trim()
  if (!META_PIXEL_ID || !accessToken) {
    // Ingen token konfigurert (typisk lokalt) — pixelen i nettleseren har
    // allerede sendt eventet, så dette er ikke en feil verdt å bråke om.
    return NextResponse.json({ skipped: "no_token" })
  }

  try {
    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) {
      return NextResponse.json({ error: "Du er ikke logget inn." }, { status: 401 })
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldige verdier." }, { status: 400 })
    }

    const cookies = request.headers.get("cookie")
    // Opt-in, også serverside: klienten sjekker det samme, men ruta skal ikke
    // stole på at den som kaller har gjort det.
    if (!hasMetaConsent(readCookie(cookies, CONSENT_COOKIE) ?? null)) {
      return NextResponse.json({ skipped: "no_consent" })
    }

    // Vercel setter x-forwarded-for; første ledd er den faktiske klienten.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()

    const payload = {
      data: [
        {
          event_name: EVENT_NAME,
          event_time: Math.floor(Date.now() / 1000),
          event_id: parsed.data.eventId,
          event_source_url: parsed.data.sourceUrl,
          action_source: "website",
          user_data: {
            fbp: readCookie(cookies, "_fbp"),
            fbc: readCookie(cookies, "_fbc"),
            client_ip_address: ip,
            client_user_agent: request.headers.get("user-agent") ?? undefined,
            ...(SEND_EMAIL_HASH && user.email
              ? {
                  em: [
                    createHash("sha256")
                      .update(user.email.trim().toLowerCase())
                      .digest("hex"),
                  ],
                }
              : {}),
          },
        },
      ],
      // Settes midlertidig for at eventene skal dukke opp under Test Events.
      ...(process.env.META_CAPI_TEST_EVENT_CODE?.trim()
        ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE.trim() }
        : {}),
    }

    const response = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      // Metas egen feilmelding sier presist hva som mangler.
      const body = (await response.text().catch(() => "")).slice(0, 500)
      await logServerError({
        message: "Meta CAPI: CompleteRegistration ble avvist",
        level: "warning",
        source: "api",
        route: "POST /api/meta/conversion",
        context: { status: response.status, body, eventId: parsed.data.eventId },
      })
      return NextResponse.json({ sent: false })
    }

    return NextResponse.json({ sent: true })
  } catch (error) {
    await logServerError({
      message: "Meta CAPI: kunne ikke sende CompleteRegistration",
      error,
      level: "warning",
      source: "api",
      route: "POST /api/meta/conversion",
    })
    // Aldri la måling se ut som en feilet registrering.
    return NextResponse.json({ sent: false })
  }
}
