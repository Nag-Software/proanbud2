import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { exchangeGoogleDriveCode, verifyDocumentOAuthState } from "@/lib/documents/oauth-flow"
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
    // This prevents the Drive identity from replacing/switching the ProAnbud session.
    const userId = await verifyDocumentOAuthState(state, "google_drive")
    if (!userId) {
      return NextResponse.json({ error: "invalid_or_expired_state" }, { status: 400 })
    }

    const tokens = await exchangeGoogleDriveCode(request, code)

    // Tokens belong to a specific user; write with the service role (the user's own
    // Supabase session is intentionally untouched, so we don't rely on RLS here).
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    await admin.from("document_integrations").upsert(
      {
        user_id: userId,
        provider: "google_drive",
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
      message: "Google Drive OAuth callback failed",
      error: e,
      source: "api",
      route: "GET /api/auth/google-drive/callback",
    })
    const message = e instanceof Error ? e.message : "internal_error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
