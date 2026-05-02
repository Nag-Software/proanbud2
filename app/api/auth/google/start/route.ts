import { NextResponse } from "next/server"
import { createServerClient } from '@supabase/ssr'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const redirectTo = process.env.GOOGLE_REDIRECT_URI ?? `${url.origin}/api/auth/google/callback`

    // collect cookies that the Supabase client wants to set
    const pendingCookies: Array<{ name: string; value: string; options?: any }> = []

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return (request as any).cookies.getAll()
          },
          setAll(cookiesToSet: any[]) {
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
        scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
      }
    })
    console.log('OAuth start (google) response:', { url: data?.url, error: error?.message })
    if (error || !data?.url) {
      return NextResponse.json({ error: error?.message ?? "failed to start oauth" }, { status: 500 })
    }

    // Attach any Set-Cookie headers Supabase requested to the redirect response
    const response = NextResponse.redirect(data.url)
    pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
    return response
  } catch (e) {
    console.error('OAuth start (google) error:', e)
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message ?? "internal error" }, { status: 500 })
  }
}
