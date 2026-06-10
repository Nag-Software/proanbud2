import { LOGIN_PATH, SIGNUP_PATH } from '../constants'

export const AUTH_PUBLIC_ROUTE_PREFIXES = [
  LOGIN_PATH,
  SIGNUP_PATH,
  '/forgot-password',
  '/api',
  '/create-company',
  '/auth/callback',
  '/tilbudsvisning',
] as const

export const SUBSCRIPTION_EXEMPT_ROUTE_PREFIXES = [
  '/onboarding',
  '/innstillinger/betaling',
  '/create-company',
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
