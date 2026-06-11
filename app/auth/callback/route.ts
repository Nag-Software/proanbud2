import { createServerClient } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

function redirectWithCookies(
  url: URL,
  pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>
) {
  const response = NextResponse.redirect(url)
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'
  const nextPath = next.startsWith('/') ? next : `/${next}`

  const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          pendingCookies.push(...cookiesToSet)
        },
      },
    }
  )

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return redirectWithCookies(new URL(nextPath, origin), pendingCookies)
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      return redirectWithCookies(new URL(nextPath, origin), pendingCookies)
    }
  }

  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('error', 'auth-callback')
  return redirectWithCookies(loginUrl, pendingCookies)
}
