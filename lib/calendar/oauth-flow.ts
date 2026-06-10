import { randomBytes } from "crypto"
import { cookies } from "next/headers"
import {
  GOOGLE_CALENDAR_SCOPES,
  MICROSOFT_CALENDAR_SCOPES,
  getGoogleCalendarRedirectUri,
  getMicrosoftCalendarRedirectUri,
  requireGoogleOAuthEnv,
  requireMicrosoftOAuthEnv,
} from "./oauth-config"

const STATE_COOKIE = "calendar_oauth_state"
const STATE_TTL_MS = 10 * 60 * 1000

type OAuthStatePayload = {
  state: string
  userId: string
  provider: "google" | "microsoft"
  exp: number
}

export type OAuthTokenResult = {
  access_token: string
  refresh_token?: string | null
  expires_at: string | null
  scope?: string | null
  token_type?: string | null
}

function createStateToken() {
  return randomBytes(24).toString("hex")
}

export async function beginCalendarOAuth(userId: string, provider: "google" | "microsoft") {
  const state = createStateToken()
  const cookieStore = await cookies()
  const payload: OAuthStatePayload = {
    state,
    userId,
    provider,
    exp: Date.now() + STATE_TTL_MS,
  }

  cookieStore.set(STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_TTL_MS / 1000,
    path: "/",
  })

  return state
}

export async function verifyCalendarOAuthState(
  state: string | null,
  provider: "google" | "microsoft"
) {
  if (!state) return null

  const cookieStore = await cookies()
  const raw = cookieStore.get(STATE_COOKIE)?.value
  if (!raw) return null

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(raw) as OAuthStatePayload
  } catch {
    return null
  }

  cookieStore.delete(STATE_COOKIE)

  if (payload.state !== state) return null
  if (payload.provider !== provider) return null
  if (payload.exp < Date.now()) return null

  return payload.userId
}

export function buildGoogleCalendarAuthUrl(request: Request, state: string) {
  const { clientId } = requireGoogleOAuthEnv()
  const redirectUri = getGoogleCalendarRedirectUri(request)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function buildMicrosoftCalendarAuthUrl(request: Request, state: string) {
  const { clientId } = requireMicrosoftOAuthEnv()
  const redirectUri = getMicrosoftCalendarRedirectUri(request)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    response_mode: "query",
    state,
  })

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
}

export async function exchangeGoogleCalendarCode(
  request: Request,
  code: string
): Promise<OAuthTokenResult> {
  const { clientId, clientSecret } = requireGoogleOAuthEnv()
  const redirectUri = getGoogleCalendarRedirectUri(request)

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token exchange failed")
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null,
    scope: data.scope ?? GOOGLE_CALENDAR_SCOPES.join(" "),
    token_type: data.token_type ?? "Bearer",
  }
}

export async function exchangeMicrosoftCalendarCode(
  request: Request,
  code: string
): Promise<OAuthTokenResult> {
  const { clientId, clientSecret } = requireMicrosoftOAuthEnv()
  const redirectUri = getMicrosoftCalendarRedirectUri(request)

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
  })

  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Microsoft token exchange failed")
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null,
    scope: data.scope ?? MICROSOFT_CALENDAR_SCOPES.join(" "),
    token_type: data.token_type ?? "Bearer",
  }
}
