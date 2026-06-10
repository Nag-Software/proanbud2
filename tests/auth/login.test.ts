import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { isAuthEntryRoute, isPublicAuthRoute } from '../../lib/auth/routes'

describe('auth route helpers', () => {
  it('treats login, signup and public API paths as public', () => {
    expect(isPublicAuthRoute('/login')).toBe(true)
    expect(isPublicAuthRoute('/signup')).toBe(true)
    expect(isPublicAuthRoute('/api/auth/google/start')).toBe(true)
    expect(isPublicAuthRoute('/tilbudsvisning/demo')).toBe(true)
    expect(isPublicAuthRoute('/')).toBe(false)
    expect(isPublicAuthRoute('/tilbud')).toBe(false)
  })

  it('identifies auth entry routes', () => {
    expect(isAuthEntryRoute('/login')).toBe(true)
    expect(isAuthEntryRoute('/signup')).toBe(true)
    expect(isAuthEntryRoute('/forgot-password')).toBe(false)
  })
})

describe('auth UI', () => {
  const loginForm = readFileSync(resolve(__dirname, '../../components/login-form.tsx'), 'utf-8')
  const signupForm = readFileSync(resolve(__dirname, '../../components/signup-form.tsx'), 'utf-8')
  const middleware = readFileSync(resolve(__dirname, '../../lib/supabase/middleware.ts'), 'utf-8')

  it('login form does not reference Apple login', () => {
    expect(loginForm).not.toMatch(/Apple/i)
    expect(loginForm).toContain('completeClientLogin')
    expect(loginForm).not.toContain('getSession')
  })

  it('signup form does not reference Apple login', () => {
    expect(signupForm).not.toMatch(/Apple/i)
    expect(signupForm).toContain('completeClientLogin')
  })

  it('middleware redirects authenticated users away from login/signup', () => {
    expect(middleware).toContain('isAuthEntryRoute')
    expect(middleware).toContain("url.pathname = '/'")
  })
})

describe('auth OAuth routes', () => {
  const googleStart = readFileSync(resolve(__dirname, '../../app/api/auth/google/start/route.ts'), 'utf-8')
  const googleCallback = readFileSync(resolve(__dirname, '../../app/api/auth/google/callback/route.ts'), 'utf-8')

  it('google login start uses signInWithOAuth', () => {
    expect(googleStart).toContain('signInWithOAuth')
    expect(googleStart).toContain('provider: "google"')
  })

  it('google login callback exchanges code for session and attaches cookies', () => {
    expect(googleCallback).toContain('exchangeCodeForSession')
    expect(googleCallback).toContain('pendingCookies')
    expect(googleCallback).toContain('user_profiles')
  })
})
