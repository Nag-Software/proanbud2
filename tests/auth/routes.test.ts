import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const googleCalendarStart = readFileSync(resolve(__dirname, '../../app/api/auth/google/calendar/start/route.ts'), 'utf-8')
const googleCalendarCallback = readFileSync(resolve(__dirname, '../../app/api/auth/google/calendar/callback/route.ts'), 'utf-8')
const microsoftCalendarStart = readFileSync(resolve(__dirname, '../../app/api/auth/microsoft/calendar/start/route.ts'), 'utf-8')
const microsoftCalendarCallback = readFileSync(resolve(__dirname, '../../app/api/auth/microsoft/calendar/callback/route.ts'), 'utf-8')

describe('calendar auth routes', () => {
  it('google calendar start requires login and uses direct oauth', () => {
    expect(googleCalendarStart).toContain('getUser')
    expect(googleCalendarStart).toContain('beginCalendarOAuth')
    expect(googleCalendarStart).toContain('buildGoogleCalendarAuthUrl')
  })

  it('google calendar callback verifies state and stores calendar tokens', () => {
    expect(googleCalendarCallback).toContain('verifyCalendarOAuthState')
    expect(googleCalendarCallback).toContain('exchangeGoogleCalendarCode')
    expect(googleCalendarCallback).toContain('upsertCalendarIntegration')
  })

  it('microsoft calendar start requires login and uses direct oauth', () => {
    expect(microsoftCalendarStart).toContain('getUser')
    expect(microsoftCalendarStart).toContain('beginCalendarOAuth')
    expect(microsoftCalendarStart).toContain('buildMicrosoftCalendarAuthUrl')
  })

  it('microsoft calendar callback verifies state and stores calendar tokens', () => {
    expect(microsoftCalendarCallback).toContain('verifyCalendarOAuthState')
    expect(microsoftCalendarCallback).toContain('exchangeMicrosoftCalendarCode')
    expect(microsoftCalendarCallback).toContain('upsertCalendarIntegration')
  })
})
