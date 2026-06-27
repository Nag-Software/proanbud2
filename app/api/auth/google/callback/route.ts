import { NextResponse } from "next/server"
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logServerError } from '@/lib/errors/log'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 })

    const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return (request as Request & { cookies: { getAll(): { name: string; value: string }[] } }).cookies.getAll()
          },
          setAll(cookiesToSet) {
            pendingCookies.push(...cookiesToSet)
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (user) {
      const fullName = (user.user_metadata as Record<string, string | undefined>)?.full_name
        ?? (user.user_metadata as Record<string, string | undefined>)?.name
        ?? null
      const avatar = (user.user_metadata as Record<string, string | undefined>)?.avatar_url ?? null

      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const supabaseAdmin = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const { error: bootstrapError } = await supabaseAdmin
          .from('users')
          .upsert(
            {
              id: user.id,
              email: user.email ?? `${user.id}@no-email.local`,
              full_name: fullName ?? user.email?.split('@')[0] ?? 'Ny Bruker',
              company_id: null,
            },
            { onConflict: 'id', ignoreDuplicates: true }
          )

        if (bootstrapError) {
          console.error('OAuth callback (google login): users bootstrap failed', bootstrapError)
          await logServerError({
            message: 'Google login users bootstrap upsert failed',
            error: bootstrapError,
            source: 'api',
            route: 'GET /api/auth/google/callback',
            userId: user.id,
          })
        }
      }

      if (fullName) {
        await supabase.from("users").update({ full_name: fullName }).eq("id", user.id)
      }
      await supabase.from("user_profiles").upsert({ user_id: user.id, avatar_url: avatar })
    }

    // Native app (Expo WebView) handoff: if this OAuth flow was started from the
    // app (pa_oauth_native cookie set by /start?native=1), hand the session back
    // via the proanbud:// deep link so the app can inject it into its WebView.
    // The tokens go in the URL fragment (#) so they are never sent to a server.
    const isNative =
      (request as Request & { cookies: { get(name: string): { value: string } | undefined } }).cookies.get(
        "pa_oauth_native"
      )?.value === "1"
    if (isNative && data?.session) {
      const fragment = new URLSearchParams({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }).toString()
      const deepLink = `proanbud://auth#${fragment}`
      // Raw 302 (not NextResponse.redirect) so the custom scheme isn't rejected.
      const response = new NextResponse(null, {
        status: 302,
        headers: { Location: deepLink },
      })
      response.cookies.set("pa_oauth_native", "", { path: "/", maxAge: 0 })
      return response
    }

    const redirectUrl = `${url.origin}/`
    const response = NextResponse.redirect(redirectUrl)
    pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
    return response
  } catch (e) {
    console.error('OAuth callback (google login) error:', e)
    await logServerError({
      message: 'Google login OAuth callback failed',
      error: e,
      source: 'api',
      route: 'GET /api/auth/google/callback',
    })
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message ?? "internal error" }, { status: 500 })
  }
}
