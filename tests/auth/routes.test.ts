import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const googleStart = readFileSync(resolve(__dirname, '../../app/api/auth/google/start/route.ts'), 'utf-8')
const googleCallback = readFileSync(resolve(__dirname, '../../app/api/auth/google/callback/route.ts'), 'utf-8')
const microsoftStart = readFileSync(resolve(__dirname, '../../app/api/auth/microsoft/start/route.ts'), 'utf-8')
const microsoftCallback = readFileSync(resolve(__dirname, '../../app/api/auth/microsoft/callback/route.ts'), 'utf-8')

describe('auth routes', () => {
  it('google start uses signInWithOAuth', () => {
    expect(googleStart).toContain('signInWithOAuth')
  })

  it('google callback exchanges code for session and upserts profile', () => {
    expect(googleCallback).toContain('exchangeCodeForSession')
    expect(googleCallback).toContain('user_profiles')
  })

  it('microsoft start uses signInWithOAuth', () => {
    expect(microsoftStart).toContain('signInWithOAuth')
  })

  it('microsoft callback exchanges code for session and upserts profile', () => {
    expect(microsoftCallback).toContain('exchangeCodeForSession')
    expect(microsoftCallback).toContain('user_profiles')
  })
})
