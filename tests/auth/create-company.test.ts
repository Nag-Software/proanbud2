import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Regression guard for the Safari onboarding bounce: after POST /api/companies
// succeeds, the page must confirm the freshly-written company link is visible to
// THIS session (same RPC the middleware gates on) before hard-navigating. Without
// it, the navigation can outrun the session and middleware bounces the user back
// to /create-company?reason=missing-company (step 1).
describe('create-company onboarding hand-off', () => {
  const page = readFileSync(
    resolve(__dirname, '../../app/create-company/page.tsx'),
    'utf-8'
  )

  it('confirms the company link via get_current_company_id before navigating', () => {
    expect(page).toContain("supabase.rpc('get_current_company_id')")

    const confirmAt = page.indexOf("supabase.rpc('get_current_company_id')")
    const navigateAt = page.indexOf('completeClientLogin(router,')

    expect(confirmAt).toBeGreaterThan(-1)
    expect(navigateAt).toBeGreaterThan(-1)
    // The visibility check must run BEFORE the navigation, not after.
    expect(confirmAt).toBeLessThan(navigateAt)
  })

  // Since the card-free trial (signup-trakt fase 1) the trial starts server-side:
  // a started trial goes straight to /onboarding/velkommen, a failed Stripe call
  // falls back to /onboarding/abonnement which retries.
  it('hands off to velkommen on started trial, abonnement as fallback', () => {
    expect(page).toContain(
      'completeClientLogin(router, created?.trialStarted ? "/onboarding/velkommen" : "/onboarding/abonnement")'
    )
  })
})
