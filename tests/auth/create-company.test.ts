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

    const confirmAt = page.indexOf("get_current_company_id")
    const navigateAt = page.indexOf('completeClientLogin(router, "/onboarding/abonnement")')

    expect(confirmAt).toBeGreaterThan(-1)
    expect(navigateAt).toBeGreaterThan(-1)
    // The visibility check must run BEFORE the navigation, not after.
    expect(confirmAt).toBeLessThan(navigateAt)
  })

  it('still hands off to the subscription onboarding step', () => {
    expect(page).toContain('completeClientLogin(router, "/onboarding/abonnement")')
  })
})
