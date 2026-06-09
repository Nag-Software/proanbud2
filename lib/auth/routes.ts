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

export function isPublicAuthRoute(pathname: string): boolean {
  return AUTH_PUBLIC_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))
}

export function isAuthEntryRoute(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === SIGNUP_PATH
}
