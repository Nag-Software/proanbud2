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
  const appleButton = readFileSync(
    resolve(__dirname, '../../components/apple-login-button.tsx'),
    'utf-8'
  )
  const globalsCss = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf-8')
  const middleware = readFileSync(resolve(__dirname, '../../lib/supabase/middleware.ts'), 'utf-8')

  // Apple-provideren er ikke satt opp i Supabase, så knappen må være AV til
  // NEXT_PUBLIC_APPLE_LOGIN=1 settes — ellers feiler innlogging med Apple.
  it('apple login is off unless NEXT_PUBLIC_APPLE_LOGIN=1', () => {
    expect(appleButton).toContain('process.env.NEXT_PUBLIC_APPLE_LOGIN === "1"')
    expect(process.env.NEXT_PUBLIC_APPLE_LOGIN).not.toBe('1')
  })

  // App Review 4.8: iOS-appen kan ikke tilby Google uten Apple. Med flagget av
  // skjules Google (og skilleteksten) i iOS-appen via native-ios-hide, mens
  // e-postinnlogging alltid står igjen.
  it('login form gates Apple behind the flag and hides Google on iOS without it', () => {
    expect(loginForm).toContain('APPLE_LOGIN_ENABLED && (')
    expect(loginForm).toContain('<AppleLoginButton')
    expect(loginForm.match(/!APPLE_LOGIN_ENABLED && "native-ios-hide"/g)).toHaveLength(2)
    expect(loginForm).toContain('autoComplete="email"')
    expect(loginForm).toContain('completeClientLogin')
    expect(loginForm).not.toContain('getSession')
  })

  it('signup form gates Apple behind the flag and hides Google on iOS without it', () => {
    expect(signupForm).toContain('APPLE_LOGIN_ENABLED && (')
    expect(signupForm).toContain('<AppleLoginButton')
    expect(signupForm.match(/!APPLE_LOGIN_ENABLED && "native-ios-hide"/g)).toHaveLength(2)
    expect(signupForm).toContain('autoComplete="email"')
    expect(signupForm).toContain('completeClientLogin')
  })

  it('native-ios-hide only applies inside the iOS app', () => {
    expect(globalsCss).toContain('html[data-native="ios"] .native-ios-hide')
    expect(globalsCss).toContain('html:not([data-native="ios"]) .native-ios-only')
    // Google-brukere uten passord må få vite veien inn i iOS-appen.
    expect(loginForm).toContain('native-ios-only')
    expect(globalsCss).not.toMatch(/^\s*\.native-ios-hide\s*\{/m)
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

  const appleStart = readFileSync(
    resolve(__dirname, '../../app/api/auth/apple/start/route.ts'),
    'utf-8'
  )
  const appleCallback = readFileSync(
    resolve(__dirname, '../../app/api/auth/apple/callback/route.ts'),
    'utf-8'
  )

  it('apple login start uses signInWithOAuth', () => {
    expect(appleStart).toContain('signInWithOAuth')
    expect(appleStart).toContain('provider: "apple"')
  })

  it('apple login callback exchanges code for session and attaches cookies', () => {
    expect(appleCallback).toContain('exchangeCodeForSession')
    expect(appleCallback).toContain('pendingCookies')
    expect(appleCallback).toContain('user_profiles')
  })
})
