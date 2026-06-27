import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { LOGIN_PATH } from "@/lib/constants"
import {
  companyHasFeature,
  getCurrentCompanyIdForUser,
} from "@/lib/billing/server-modules"
import {
  beginCalendarOAuth,
  buildMicrosoftCalendarAuthUrl,
} from "@/lib/calendar/oauth-flow"
import { logServerError } from "@/lib/errors/log"

export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(new URL(LOGIN_PATH, request.url))
    }

    const companyId = await getCurrentCompanyIdForUser(user.id)
    if (!(await companyHasFeature(companyId, "kalender"))) {
      return NextResponse.redirect(new URL("/innstillinger/betaling", request.url))
    }

    const state = await beginCalendarOAuth(user.id, "microsoft")
    const authUrl = buildMicrosoftCalendarAuthUrl(request, state)
    return NextResponse.redirect(authUrl)
  } catch (e) {
    console.error("OAuth start (microsoft calendar) error:", e)
    await logServerError({
      message: "Microsoft calendar OAuth start failed",
      error: e,
      source: "api",
      route: "GET /api/auth/microsoft/calendar/start",
    })
    const message = e instanceof Error ? e.message : "internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
