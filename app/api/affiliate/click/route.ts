import { NextResponse } from "next/server"
import { z } from "zod"

import { corsHeaders } from "@/lib/affiliate/cors"
import { normalizeCode } from "@/lib/affiliate/referral-code"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Public click counter for referral links. The marketing site's /r/<code> route
 * pings this (fire-and-forget) when someone follows a seller's share link, so
 * `affiliate_partners.clicks` reflects real traffic. Atomic via the
 * bump_affiliate_clicks() RPC; unknown codes are a silent no-op (and we always
 * answer ok, so the endpoint never reveals which codes exist).
 */

export const dynamic = "force-dynamic"

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  })
}

const clickSchema = z.object({ code: z.string().trim().min(1).max(80) })

export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"))

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers })
  }

  const parsed = clickSchema.safeParse(payload)
  const code = parsed.success ? normalizeCode(parsed.data.code) : null
  if (!code) {
    return NextResponse.json({ ok: false }, { status: 400, headers })
  }

  try {
    await createAdminClient().rpc("bump_affiliate_clicks", { p_code: code })
  } catch (error) {
    console.warn("[affiliate] click bump failed:", error)
  }

  return NextResponse.json({ ok: true }, { headers })
}
