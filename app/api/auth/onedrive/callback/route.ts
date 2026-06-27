import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { exchangeOneDriveCode, verifyDocumentOAuthState } from "@/lib/documents/oauth-flow"
import { logServerError } from "@/lib/errors/log"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const oauthError = url.searchParams.get("error")

    if (oauthError) {
      return NextResponse.redirect(
        `${url.origin}/dokumenter?drive_error=${encodeURIComponent(oauthError)}`
      )
    }
    if (!code) {
      return NextResponse.json({ error: "missing_code" }, { status: 400 })
    }

    // Resolve the user from the signed state cookie — NOT from a fresh OAuth session.
    const userId = await verifyDocumentOAuthState(state, "onedrive")
    if (!userId) {
      return NextResponse.json({ error: "invalid_or_expired_state" }, { status: 400 })
    }

    const tokens = await exchangeOneDriveCode(request, code)

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    await admin.from("document_integrations").upsert(
      {
        user_id: userId,
        provider: "onedrive",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: tokens.expires_at,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? "Bearer",
        account_email: tokens.account_email ?? null,
        account_name: tokens.account_name ?? null,
      },
      { onConflict: "user_id,provider" }
    )

    return NextResponse.redirect(`${url.origin}/dokumenter`)
  } catch (e) {
    await logServerError({
      message: "OneDrive OAuth callback failed",
      error: e,
      source: "api",
      route: "GET /api/auth/onedrive/callback",
    })
    const message = e instanceof Error ? e.message : "internal_error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
