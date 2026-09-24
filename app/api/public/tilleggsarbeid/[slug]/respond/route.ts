import { NextResponse } from "next/server"
import { z } from "zod"

import {
  acceptChangeOrderWithCode,
  rejectChangeOrder,
  requestChangeOrderAcceptCode,
} from "@/lib/tilleggsarbeid/approval"
import { fetchPublicChangeOrderBySlug } from "@/lib/tilleggsarbeid/change-order"

const respondSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request_code") }),
  z.object({
    action: z.literal("accept"),
    name: z.string().trim().min(2, "Skriv fullt navn").max(120),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Koden er 6 sifre"),
  }),
  z.object({ action: z.literal("reject") }),
])

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  no_code: "Be om en engangskode først.",
  expired: "Engangskoden er utløpt. Be om en ny kode.",
  wrong_code: "Feil kode. Prøv igjen.",
  too_many_attempts: "For mange forsøk. Be om en ny kode.",
  not_respondable: "Tilleggsarbeidet kan ikke besvares lenger.",
  server_error: "Noe gikk galt. Prøv igjen.",
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const record = await fetchPublicChangeOrderBySlug(slug)
  if (!record) return NextResponse.json({ error: "Fant ikke tilleggsarbeidet" }, { status: 404 })
  if (!record.canRespond) return NextResponse.json({ error: "Allerede besvart" }, { status: 409 })

  const parsed = respondSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ugyldig forespørsel" }, { status: 400 })
  }

  if (parsed.data.action === "request_code") {
    const result = await requestChangeOrderAcceptCode(record)
    if (!result.ok) {
      if (result.error === "cooldown") {
        return NextResponse.json(
          { error: `Vent ${result.retryInSeconds} sekunder før du ber om ny kode`, retryInSeconds: result.retryInSeconds },
          { status: 429 }
        )
      }
      if (result.error === "missing_email") {
        return NextResponse.json({ error: "Bedriften har ikke lagt inn e-postadressen din. Ta kontakt med dem." }, { status: 400 })
      }
      return NextResponse.json({ error: "Kunne ikke sende engangskode" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, maskedEmail: result.maskedEmail })
  }

  if (parsed.data.action === "accept") {
    const result = await acceptChangeOrderWithCode({
      record,
      name: parsed.data.name,
      code: parsed.data.code,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: request.headers.get("user-agent") || null,
    })
    if (!result.ok) {
      return NextResponse.json(
        {
          error: ACCEPT_ERROR_MESSAGES[result.error] ?? ACCEPT_ERROR_MESSAGES.server_error,
          code: result.error,
          attemptsLeft: result.attemptsLeft,
        },
        { status: result.error === "server_error" ? 500 : 400 }
      )
    }
    return NextResponse.json({ ok: true, status: "accepted" })
  }

  const rejected = await rejectChangeOrder(record)
  if (!rejected.ok) return NextResponse.json({ error: "Kunne ikke lagre svaret ditt" }, { status: 500 })
  return NextResponse.json({ ok: true, status: "rejected" })
}
