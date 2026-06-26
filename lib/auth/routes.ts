import { LOGIN_PATH, SIGNUP_PATH } from '../constants'

export const AUTH_PUBLIC_ROUTE_PREFIXES = [
  LOGIN_PATH,
  SIGNUP_PATH,
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/privacy',
  '/api',
  '/create-company',
  '/auth/callback',
  '/tilbudsvisning',
  '/eksempel-tilbud',
] as const

export const SUBSCRIPTION_EXEMPT_ROUTE_PREFIXES = [
  '/onboarding',
  '/innstillinger/betaling',
  '/create-company',
  // Read-only page shown to non-admin members when the company subscription has
  // lapsed (they cannot pay — only the admin can). Must be exempt so it doesn't
  // redirect-loop on the subscription gate.
  '/abonnement-utlopt',
] as const

export const ADMIN_ONBOARDING_ROUTE_PREFIXES = [
  '/create-company',
  '/onboarding',
  '/innstillinger/betaling',
] as const

export function isPublicAuthRoute(pathname: string): boolean {
  return AUTH_PUBLIC_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))
}

export function isSubscriptionExemptRoute(pathname: string): boolean {
  return SUBSCRIPTION_EXEMPT_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))
}

export function isAuthEntryRoute(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === SIGNUP_PATH
}

export function isAdminOnboardingRoute(pathname: string): boolean {
  return ADMIN_ONBOARDING_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))
}
