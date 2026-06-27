// Fiken API + OAuth2 configuration.
// Base URL: https://api.fiken.no/api/v2 (single host — no separate sandbox; testing
// uses a company flagged testCompany=true). All resource paths are scoped by
// /companies/{companySlug}. Auth is OAuth2 authorization_code (Bearer access+refresh)
// at app level; personal API tokens exist but are ToS-violating for multi-tenant use.

export const FIKEN_HELP_URL = "https://fiken.no/api"

export const FIKEN_OAUTH_AUTHORIZE_URL = "https://fiken.no/oauth/authorize"
export const FIKEN_OAUTH_TOKEN_URL = "https://fiken.no/oauth/token"
export const FIKEN_OAUTH_SCOPES = "read write"

export const FIKEN_APP_BASE = "https://fiken.no"

export function getFikenApiBaseUrl() {
  return process.env.FIKEN_BASE_URL?.trim() || "https://api.fiken.no/api/v2"
}

export function getFikenClientId() {
  const id = process.env.FIKEN_CLIENT_ID?.trim()
  if (!id) {
    throw new Error("FIKEN_CLIENT_ID is missing")
  }
  return id
}

export function getFikenClientSecret() {
  const secret = process.env.FIKEN_CLIENT_SECRET?.trim()
  if (!secret) {
    throw new Error("FIKEN_CLIENT_SECRET is missing")
  }
  return secret
}

export function hasFikenOAuthConfig() {
  return Boolean(process.env.FIKEN_CLIENT_ID?.trim() && process.env.FIKEN_CLIENT_SECRET?.trim())
}

/**
 * Registered OAuth redirect URI. Falls back to building from the public app origin.
 * Must match the value registered in the Fiken App exactly.
 */
export function getFikenRedirectUri() {
  const explicit = process.env.FIKEN_OAUTH_REDIRECT_URI?.trim()
  if (explicit) {
    return explicit
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)

  if (!origin) {
    throw new Error("FIKEN_OAUTH_REDIRECT_URI (or NEXT_PUBLIC_APP_URL) is missing")
  }

  return `${origin.replace(/\/$/, "")}/api/integrations/fiken/oauth/callback`
}

/** HTTP Basic credential for the Fiken token endpoint (client_id:client_secret). */
export function getFikenTokenBasicAuthHeader() {
  const composite = `${getFikenClientId()}:${getFikenClientSecret()}`
  return `Basic ${Buffer.from(composite).toString("base64")}`
}
