import { NextResponse } from "next/server"
import { createServerClient } from '@supabase/ssr'

function getAppBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
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
    return response
  } catch (e) {
    console.error('OAuth start (google login) error:', e)
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message ?? "internal error" }, { status: 500 })
  }
}
