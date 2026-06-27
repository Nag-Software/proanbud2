import { randomBytes } from "crypto"
import { cookies } from "next/headers"

/**
 * Direct OAuth flow for document storage (Google Drive / OneDrive).
 *
 * This deliberately does NOT use supabase.auth.signInWithOAuth /
 * exchangeCodeForSession: those REPLACE the current Supabase session with the
 * Google/Microsoft identity, which silently switched the logged-in ProAnbud user
 * to (or auto-created) a different account whenever the Drive e-mail differed from
 * the app login — a confused-deputy / account-takeover bug in a multi-tenant SaaS.
 *
 * Instead we bind the OAuth round-trip to the already-authenticated user via a
 * signed, httpOnly state cookie and exchange the code directly against the provider
 * token endpoint. The Supabase session is never touched.
 */

const STATE_COOKIE = "document_oauth_state"
const STATE_TTL_MS = 10 * 60 * 1000

export type DocumentProvider = "google_drive" | "onedrive"

type OAuthStatePayload = {
  state: string
  userId: string
  provider: DocumentProvider
  exp: number
}

export type DocumentTokenResult = {
  access_token: string
  refresh_token?: string | null
  expires_at: string | null
  scope?: string | null
  token_type?: string | null
  account_email?: string | null
  account_name?: string | null
}

const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
]

const ONEDRIVE_SCOPES = ["offline_access", "Files.ReadWrite", "User.Read"]

function getAppBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
}

function getGoogleDriveRedirectUri(request: Request) {
  return (
    process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() ||
    `${getAppBaseUrl(request)}/api/auth/google-drive/callback`
  )
}

function getOneDriveRedirectUri(request: Request) {
  return (
    process.env.ONEDRIVE_REDIRECT_URI?.trim() ||
    `${getAppBaseUrl(request)}/api/auth/onedrive/callback`
  )
}

function requireGoogleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID og GOOGLE_CLIENT_SECRET må være satt for Google Drive.")
  }
  return { clientId, clientSecret }
}

function requireMicrosoftEnv() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim()
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID og MICROSOFT_CLIENT_SECRET må være satt for OneDrive.")
  }
  return { clientId, clientSecret }
}

export async function beginDocumentOAuth(userId: string, provider: DocumentProvider) {
  const state = randomBytes(24).toString("hex")
  const cookieStore = await cookies()
  const payload: OAuthStatePayload = { state, userId, provider, exp: Date.now() + STATE_TTL_MS }

  cookieStore.set(STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_TTL_MS / 1000,
    path: "/",
  })

  return state
}

export async function verifyDocumentOAuthState(state: string | null, provider: DocumentProvider) {
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

export function buildGoogleDriveAuthUrl(request: Request, state: string) {
  const { clientId } = requireGoogleEnv()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleDriveRedirectUri(request),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function buildOneDriveAuthUrl(request: Request, state: string) {
  const { clientId } = requireMicrosoftEnv()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOneDriveRedirectUri(request),
    response_type: "code",
    scope: ONEDRIVE_SCOPES.join(" "),
    response_mode: "query",
    state,
  })
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
}

export async function exchangeGoogleDriveCode(
  request: Request,
  code: string
): Promise<DocumentTokenResult> {
  const { clientId, clientSecret } = requireGoogleEnv()
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGoogleDriveRedirectUri(request),
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

  let account_email: string | null = null
  let account_name: string | null = null
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    if (profileRes.ok) {
      const profile = await profileRes.json()
      account_email = profile?.email ?? null
      account_name = profile?.name ?? null
    }
  } catch {
    // Best-effort profile lookup.
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null,
    scope: data.scope ?? GOOGLE_DRIVE_SCOPES.join(" "),
    token_type: data.token_type ?? "Bearer",
    account_email,
    account_name,
  }
}

export async function exchangeOneDriveCode(
  request: Request,
  code: string
): Promise<DocumentTokenResult> {
  const { clientId, clientSecret } = requireMicrosoftEnv()
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getOneDriveRedirectUri(request),
    grant_type: "authorization_code",
    scope: ONEDRIVE_SCOPES.join(" "),
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

  let account_email: string | null = null
  let account_name: string | null = null
  try {
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    if (profileRes.ok) {
      const profile = await profileRes.json()
      account_email = profile?.mail ?? profile?.userPrincipalName ?? null
      account_name = profile?.displayName ?? null
    }
  } catch {
    // Best-effort profile lookup.
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null,
    scope: data.scope ?? ONEDRIVE_SCOPES.join(" "),
    token_type: data.token_type ?? "Bearer",
    account_email,
    account_name,
  }
}
