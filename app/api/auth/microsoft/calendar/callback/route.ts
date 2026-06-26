import { NextResponse } from "next/server"
import {
  exchangeMicrosoftCalendarCode,
  verifyCalendarOAuthState,
} from "@/lib/calendar/oauth-flow"
import { upsertCalendarIntegration } from "@/lib/calendar/store-integration"
import { getAppBaseUrl } from "@/lib/calendar/oauth-config"
import { logServerError } from "@/lib/errors/log"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const oauthError = url.searchParams.get("error")

    if (oauthError) {
      const description = url.searchParams.get("error_description") ?? oauthError
      return NextResponse.redirect(
        `${getAppBaseUrl(request)}/kalender?calendar_error=${encodeURIComponent(description)}`
      )
    }

    if (!code) {
      return NextResponse.json({ error: "missing code" }, { status: 400 })
    }

    const userId = await verifyCalendarOAuthState(state, "microsoft")
    if (!userId) {
      return NextResponse.json({ error: "invalid or expired oauth state" }, { status: 400 })
    }

    const tokens = await exchangeMicrosoftCalendarCode(request, code)
    await upsertCalendarIntegration(userId, "microsoft", tokens)

    return NextResponse.redirect(`${getAppBaseUrl(request)}/kalender?calendar_connected=microsoft`)
  } catch (e) {
    console.error("OAuth callback (microsoft calendar) error:", e)
    await logServerError({
      message: "Microsoft calendar OAuth callback failed",
      error: e,
      source: "api",
      route: "GET /api/auth/microsoft/calendar/callback",
    })
    const message = e instanceof Error ? e.message : "internal error"
    return NextResponse.redirect(
      `${getAppBaseUrl(request)}/kalender?calendar_error=${encodeURIComponent(message)}`
    )
  }
}
