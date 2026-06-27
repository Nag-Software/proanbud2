import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { LOGIN_PATH } from "@/lib/constants"
import { beginDocumentOAuth, buildGoogleDriveAuthUrl } from "@/lib/documents/oauth-flow"
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

    // Bind the OAuth round-trip to the already-authenticated user (state cookie) and
    // run a direct Google OAuth flow — never supabase.signInWithOAuth, which would
    // hijack the current session.
    const state = await beginDocumentOAuth(user.id, "google_drive")
    return NextResponse.redirect(buildGoogleDriveAuthUrl(request, state))
  } catch (e) {
    await logServerError({
      message: "Google Drive OAuth start failed",
      error: e,
      source: "api",
      route: "GET /api/auth/google-drive/start",
    })
    const message = e instanceof Error ? e.message : "internal_error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
