import { NextResponse } from "next/server"
import { createServerClient } from '@supabase/ssr'

function getAppBaseUrl(request: Request) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
  // Strip any trailing slash so we never build `.../api/...` with a double slash
  // (a doubled path breaks Supabase's redirect_to allowlist match).
  return base.replace(/\/+$/, "")
}

export async function GET(request: Request) {
  try {
    const redirectTo = process.env.GOOGLE_LOGIN_REDIRECT_URI?.trim()
      ?? `${getAppBaseUrl(request)}/api/auth/google/callback`

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

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })

    if (error || !data?.url) {
      return NextResponse.json({ error: error?.message ?? "failed to start oauth" }, { status: 500 })
    }

    const response = NextResponse.redirect(data.url)
    pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))

    // Native app (Expo WebView) handoff: Google blocks OAuth inside embedded
    // WebViews, so the app opens this flow in the system browser with ?native=1.
    // Remember it here so the callback returns the session via the proanbud://
    // deep link instead of the normal web redirect.
    const isNative = new URL(request.url).searchParams.get("native") === "1"
    if (isNative) {
      response.cookies.set("pa_oauth_native", "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 600,
      })
    }
    return response
  } catch (e) {
    console.error('OAuth start (google login) error:', e)
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message ?? "internal error" }, { status: 500 })
  }
}
