import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { LOGIN_PATH } from "@/lib/constants"
import { beginDocumentOAuth, buildOneDriveAuthUrl } from "@/lib/documents/oauth-flow"
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

    // Bind the OAuth round-trip to the authenticated user and run a direct Microsoft
    // OAuth flow — never supabase.signInWithOAuth, which would hijack the session.
    const state = await beginDocumentOAuth(user.id, "onedrive")
    return NextResponse.redirect(buildOneDriveAuthUrl(request, state))
  } catch (e) {
    await logServerError({
      message: "OneDrive OAuth start failed",
      error: e,
      source: "api",
      route: "GET /api/auth/onedrive/start",
    })
    const message = e instanceof Error ? e.message : "internal_error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
