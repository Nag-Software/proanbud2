import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  isAdminOnboardingRoute,
  isAuthEntryRoute,
  isPublicAuthRoute,
  isSubscriptionExemptRoute,
} from '@/lib/auth/routes'
import { isActiveSubscriptionStatus } from '@/lib/billing/plans'
import { isInvitedCompanyMember } from '@/lib/roles'
import { LOGIN_PATH } from '@/lib/constants'
import { isPlatformAdminEmail, isSjefenApiRoute, isSjefenRoute } from '@/lib/auth/platform-admin'
import { canAccessSelger, isSelgerApiRoute, isSelgerRoute } from '@/lib/auth/platform-seller'
import { MOCK_ROLE_COOKIE, isRoleMockEnabled, resolveMockRoleParam } from '@/lib/auth/role-mock'

// Short-lived, per-user cache so steady-state navigation can skip the
// onboarding/subscription RPCs. Only ever skips the already-verified "pass"
// case — it can never introduce a redirect, and re-verifies after TTL.
const GATE_COOKIE = 'pa_gate_ok'
const GATE_TTL_SECONDS = 120

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
  const isPublic = isPublicAuthRoute(pathname)

  // Dev role mock: `?mock=worker|pm|admin|clear` sets a cookie and redirects to
  // a clean URL. Applied to role gating only; real RLS still governs data.
  if (isRoleMockEnabled() && user && request.nextUrl.searchParams.has('mock')) {
    const resolution = resolveMockRoleParam(request.nextUrl.searchParams.get('mock'))
    if (resolution.kind !== 'ignore') {
      const url = request.nextUrl.clone()
      url.searchParams.delete('mock')
      const redirect = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
        redirect.cookies.set(name, value)
      })
      if (resolution.kind === 'set') {
        redirect.cookies.set(MOCK_ROLE_COOKIE, resolution.role, {
          path: '/',
          sameSite: 'lax',
        })
      } else {
        redirect.cookies.set(MOCK_ROLE_COOKIE, '', { path: '/', maxAge: 0 })
      }
      return redirect
    }
  }

  if (user && isAuthEntryRoute(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    const redirect = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
      redirect.cookies.set(name, value)
    })
    return redirect
  }

  if (!user && !isPublic) {
    // No active session: redirect protected routes to login.
    const url = request.nextUrl.clone()
    url.pathname = LOGIN_PATH
    url.searchParams.set('reason', 'no-session')
    return NextResponse.redirect(url)
  }

  if (user && isSjefenRoute(pathname)) {
    if (!isPlatformAdminEmail(user.email)) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      const redirect = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
        redirect.cookies.set(name, value)
      })
      return redirect
    }

    return supabaseResponse
  }

  if (user && isSjefenApiRoute(pathname)) {
    if (!isPlatformAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

    return supabaseResponse
  }

  if (!user && isSjefenApiRoute(pathname)) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  if (user && isSelgerRoute(pathname)) {
    if (!canAccessSelger(user.email)) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      const redirect = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
        redirect.cookies.set(name, value)
      })
      return redirect
    }

    return supabaseResponse
  }

  if (user && isSelgerApiRoute(pathname)) {
    if (!canAccessSelger(user.email)) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

    return supabaseResponse
  }

  if (!user && isSelgerApiRoute(pathname)) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  if (user && !isPublic) {
    // Onboarding/subscription gating only applies to normal app routes; the
    // onboarding, subscription-exempt and create-company routes always run the
    // full checks (and never get cached).
    const cacheableGate =
      !isAdminOnboardingRoute(pathname) &&
      !isSubscriptionExemptRoute(pathname) &&
      pathname !== '/create-company'

    // Recently verified this exact user is fully onboarded + active → skip RPCs.
    if (cacheableGate && request.cookies.get(GATE_COOKIE)?.value === user.id) {
      return supabaseResponse
    }

    // Prefer RPC (SECURITY DEFINER) to avoid false negatives from users table RLS visibility.
    let companyId: string | null = null
    let isCompanyAdmin = false
    let userRole: string | null = null

    // These two RPCs are independent — run them in parallel to save a round trip
    // on every navigation.
    const [companyIdResult, isAdminResult] = await Promise.all([
      supabase.rpc('get_current_company_id'),
      supabase.rpc('is_company_admin'),
    ])
    const { data: rpcCompanyId, error: rpcError } = companyIdResult
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

    const { data: rpcIsAdmin, error: adminRpcError } = isAdminResult
    if (adminRpcError) {
      console.error('Middleware is_company_admin RPC failed', {
        userId: user.id,
        pathname,
        code: adminRpcError.code,
        message: adminRpcError.message,
      })
    } else {
      isCompanyAdmin = rpcIsAdmin === true
    }

    // Fallback when RPC is unavailable/misconfigured.
    if (rpcError || adminRpcError) {
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('company_id, role')
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
        if (!companyId) {
          companyId = profile?.company_id ?? null
        }
        userRole = profile?.role ?? null
        if (adminRpcError) {
          isCompanyAdmin = profile?.role === 'admin'
        }
      }
    }

    if (!companyId && userRole === null) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      userRole = profile?.role ?? null
    }

    if (!isCompanyAdmin && isAdminOnboardingRoute(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      const redirect = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
        redirect.cookies.set(name, value)
      })
      return redirect
    }

    if (!companyId && pathname !== '/create-company' && pathname !== '/ingen-tilgang') {
      if (isInvitedCompanyMember(userRole)) {
        // Invited member (worker/manager) without a company link — send to a
        // dedicated, whitelisted page. Must NOT redirect to '/' (which is itself
        // gated and would re-trigger this same redirect → ERR_TOO_MANY_REDIRECTS).
        const url = request.nextUrl.clone()
        url.pathname = '/ingen-tilgang'
        url.search = ''
        const redirect = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
          redirect.cookies.set(name, value)
        })
        return redirect
      }

      const url = request.nextUrl.clone()
      url.pathname = '/create-company'
      url.searchParams.set('reason', 'missing-company')
      return NextResponse.redirect(url)
    }

    if (companyId && isCompanyAdmin && !isSubscriptionExemptRoute(pathname)) {
      let subscriptionStatus: string | null = null

      const { data: rpcStatus, error: statusError } = await supabase.rpc(
        'get_current_subscription_status'
      )

      if (statusError) {
        console.error('Middleware get_current_subscription_status RPC failed', {
          userId: user.id,
          pathname,
          code: statusError.code,
          message: statusError.message,
        })
      } else {
        subscriptionStatus = rpcStatus ?? 'incomplete'
      }

      if (subscriptionStatus && !isActiveSubscriptionStatus(subscriptionStatus)) {
        const url = request.nextUrl.clone()
        url.pathname = '/onboarding/abonnement'
        url.searchParams.set('reason', 'missing-subscription')
        const redirect = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
          redirect.cookies.set(name, value)
        })
        return redirect
      }
    }

    // Fully verified (onboarded + active) — cache briefly so subsequent
    // navigations can skip the RPCs above. Only cache users WITH a company, so
    // a company-less user is never allowed to skip the onboarding redirect.
    if (cacheableGate && companyId) {
      supabaseResponse.cookies.set(GATE_COOKIE, user.id, {
        path: '/',
        maxAge: GATE_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'lax',
      })
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  return supabaseResponse
}
