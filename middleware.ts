import { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // Delegate to supabase session updater which may return a redirect
  const res = await updateSession(request)
  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones below. `updateSession` does a
     * supabase.auth.getUser() round-trip on every match, so we also skip routes
     * that authenticate via signature/secret and never read the user cookie:
     * - _next/static / _next/image (build assets)
     * - favicon.ico and static asset extensions
     * - the api/webhooks folder and any route ending in "webhook" (Stripe, Resend, DocuSign, Tripletex…)
     * - api/outreach/cron (secret-authed cron)
     * - sw.js and the web app manifest (must be reachable while logged out so the PWA installs)
     * (Do NOT exclude /api/sjefen or /api/selger — those rely on the refreshed session.)
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|api/webhooks/|api/outreach/cron|api/(?:.*/)?webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|map|webmanifest)$).*)',
  ],
}
