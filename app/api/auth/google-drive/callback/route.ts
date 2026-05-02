import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    if (!code) {
      return NextResponse.json({ error: "missing_code" }, { status: 400 })
    }
    const supabase = await createServerSupabase()

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
    }

    const accessToken = data.session?.provider_token
    const refreshToken = data.session?.provider_refresh_token

    if (accessToken) {
      let accountEmail: string | null = null
      let accountName: string | null = null

      try {
        const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (profileRes.ok) {
          const profile = await profileRes.json()
          accountEmail = profile?.email ?? null
          accountName = profile?.name ?? null
        }
      } catch {
        // Best effort profile lookup.
      }

      await supabase.from("document_integrations").upsert(
        {
          user_id: user.id,
          provider: "google_drive",
          access_token: accessToken,
          refresh_token: refreshToken ?? null,
          scope: data.session?.provider_token ? "drive" : null,
          token_type: "Bearer",
          account_email: accountEmail,
          account_name: accountName,
        },
        { onConflict: "user_id,provider" }
      )
    }

    return NextResponse.redirect(`${url.origin}/dokumenter`)
  } catch (e) {
    const message = e instanceof Error ? e.message : "internal_error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
