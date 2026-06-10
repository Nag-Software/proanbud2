export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
] as const

export const MICROSOFT_CALENDAR_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  "Calendars.ReadWrite",
] as const

export function getAppBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
}

export function getGoogleCalendarRedirectUri(request: Request) {
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() ||
    `${getAppBaseUrl(request)}/api/auth/google/calendar/callback`
  )
}

export function getMicrosoftCalendarRedirectUri(request: Request) {
  return (
    process.env.MICROSOFT_CALENDAR_REDIRECT_URI?.trim() ||
    `${getAppBaseUrl(request)}/api/auth/microsoft/calendar/callback`
  )
}

export function requireGoogleOAuthEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID og GOOGLE_CLIENT_SECRET må være satt i .env.local for Google Calendar."
    )
  }
  return { clientId, clientSecret }
}

export function requireMicrosoftOAuthEnv() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim()
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error(
      "MICROSOFT_CLIENT_ID og MICROSOFT_CLIENT_SECRET må være satt i .env.local for Outlook Calendar."
    )
  }
  return { clientId, clientSecret }
}
