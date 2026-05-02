import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { LOGIN_PATH, SIGNUP_PATH } from '@/lib/constants'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  const publicRoutes = [
    LOGIN_PATH,
    SIGNUP_PATH,
    '/forgot-password',
    '/api', // Adjust if you want some APIs protected in middleware
    '/create-company',
    '/auth/callback'
  ]

  const isPublic = publicRoutes.some((route) => pathname.startsWith(route))

  if (!user && !isPublic) {
    // No active session: redirect protected routes to login.
    const url = request.nextUrl.clone()
    url.pathname = LOGIN_PATH
    url.searchParams.set('reason', 'no-session')
    return NextResponse.redirect(url)
  }

  if (user && !isPublic) {
    // Prefer RPC (SECURITY DEFINER) to avoid false negatives from users table RLS visibility.
    let companyId: string | null = null

    const { data: rpcCompanyId, error: rpcError } = await supabase.rpc('get_current_company_id')
    if (rpcError) {
      console.error('Middleware get_current_company_id RPC failed', {
        userId: user.id,
        pathname,
        code: rpcError.code,
        message: rpcError.message,
      })
    } else {
      companyId = rpcCompanyId ?? null
    }

    // Fallback when RPC is unavailable/misconfigured.
    if (!companyId && rpcError) {
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) {
        console.error('Middleware users lookup fallback failed', {
          userId: user.id,
          pathname,
          code: profileError.code,
          message: profileError.message,
        })
      } else {
        companyId = profile?.company_id ?? null
      }
    }

    if (!companyId && pathname !== '/create-company') {
      const url = request.nextUrl.clone()
      url.pathname = '/create-company'
      url.searchParams.set('reason', 'missing-company')
      return NextResponse.redirect(url)
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  return supabaseResponse
}
