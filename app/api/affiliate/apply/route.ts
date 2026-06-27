import { NextResponse } from "next/server"
import { z } from "zod"

import { sendAffiliateApplicationEmail } from "@/lib/affiliate/notify"
import { createAffiliatePartner } from "@/lib/affiliate/queries"

/**
 * Public intake for the marketing site's /bli-selger form.
 *
 * The form lives on www.proanbud.no and posts cross-origin to this app
 * (nye.proanbud.no), so the route answers CORS preflight and echoes an
 * allowed *.proanbud.no origin. The application is stored in
 * `affiliate_partners` (the source of truth shown in /sjefen/selgere) and a
 * notification is e-mailed to post@proanbud.no. E-mail is best-effort: as long
 * as storage succeeds the response is ok, so a missing RESEND_API_KEY never
 * loses an application. Only a storage failure returns 500, which lets the form
 * fall back to its mailto path.
 *
 * This path matches the marketing form's default APPLY_URL
 * (`${appUrl}/api/affiliate/apply`), so no change is needed there.
 */

export const dynamic = "force-dynamic"

function resolveOrigin(origin: string | null): string {
  if (origin) {
    try {
      const host = new URL(origin).hostname
      if (host === "proanbud.no" || host.endsWith(".proanbud.no") || host === "localhost") {
        return origin
      }
    } catch {
      // fall through to default
    }
  }
  return "https://www.proanbud.no"
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  })
}

const applicationSchema = z.object({
  contactName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  companyName: z.string().trim().max(160).optional().default(""),
  orgNr: z.string().trim().max(40).optional().default(""),
  channel: z.string().trim().max(4000).optional().default(""),
  source: z.string().trim().max(60).optional().default("bli-selger"),
})

export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"))

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400, headers })
  }

  const parsed = applicationSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Fyll inn navn og en gyldig e-post." },
      { status: 400, headers },
    )
  }

  const data = parsed.data

  let created
  try {
    created = await createAffiliatePartner(data)
  } catch (error) {
    console.error("Failed to store affiliate application:", error)
    return NextResponse.json(
      { error: "Kunne ikke ta imot søknaden akkurat nå." },
      { status: 500, headers },
    )
  }

  const emailResult = await sendAffiliateApplicationEmail({
    contactName: data.contactName,
    email: data.email,
    phone: data.phone,
    companyName: data.companyName,
    orgNr: data.orgNr,
    channel: data.channel,
    referralCode: created.referralCode,
  }).catch((error) => {
    console.error("Affiliate application email threw:", error)
    return { sent: false, error: "threw" as const }
  })

  if (!emailResult.sent) {
    console.warn("Affiliate application stored but not emailed:", emailResult.error)
  }

  return NextResponse.json({ ok: true }, { headers })
}
