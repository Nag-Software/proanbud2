import crypto from "crypto"
import { readFile } from "node:fs/promises"

type DocusignAuthContext = {
  accessToken: string
  accountId: string
  baseUri: string
}

type DocusignAccount = {
  account_id?: string
  accountId?: string
  is_default?: boolean
  isDefault?: boolean
  base_uri?: string
  baseUri?: string
}

function toBase64Url(input: Buffer | string) {
  const value = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input).toString("base64")
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function normalizePemKey(raw: string) {
  const trimmed = raw.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed
}

function looksLikeBase64(value: string) {
  const compact = value.replace(/\s+/g, "")
  return compact.length > 128 && /^[A-Za-z0-9+/=]+$/.test(compact)
}

function decodeBase64ToPem(value: string) {
  try {
    const decoded = Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8")
    return decoded.includes("BEGIN") ? decoded : value
  } catch {
    return value
  }
}

async function resolvePrivateKey() {
  const inlineRaw = process.env.DOCUSIGN_PRIVATE_KEY || ""
  const keyPath = process.env.DOCUSIGN_PRIVATE_KEY_PATH || ""

  let resolved = ""

  if (inlineRaw) {
    const normalizedInline = normalizePemKey(inlineRaw)
    resolved = looksLikeBase64(normalizedInline) ? decodeBase64ToPem(normalizedInline) : normalizedInline
  }

  if (!resolved && keyPath) {
    try {
      const fromFile = await readFile(keyPath, "utf8")
      resolved = normalizePemKey(fromFile)
    } catch (error) {
      throw new Error(
        `Kunne ikke lese DOCUSIGN_PRIVATE_KEY_PATH: ${error instanceof Error ? error.message : "ukjent feil"}`
      )
    }
  }

  return resolved
}

function authHostFromBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return "account-d.docusign.com"
  }
}

function normalizeAuthBaseUrl(input: string) {
  const trimmed = (input || "").trim()
  if (!trimmed) return "https://account-d.docusign.com"

  if (trimmed.includes("demo.docusign.net")) {
    return "https://account-d.docusign.com"
  }

  if (trimmed.includes("apps-d.docusign.com")) {
    return "https://account-d.docusign.com"
  }

  return trimmed
}

function resolveRedirectUri() {
  const redirectUri = (process.env.DOCUSIGN_REDIRECT_URI || "").trim()
  if (!redirectUri) {
    throw new Error("DOCUSIGN_REDIRECT_URI mangler. Legg den til i .env.local og i DocuSign App Redirect URIs.")
  }
  return redirectUri
}

async function resolveJwtEnv() {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY || ""
  const userId = process.env.DOCUSIGN_USER_ID || ""
  const authBaseUrl = normalizeAuthBaseUrl(process.env.DOCUSIGN_AUTH_BASE_URL || "https://account-d.docusign.com")
  const privateKey = await resolvePrivateKey()

  return {
    integrationKey,
    userId,
    privateKey,
    authBaseUrl,
  }
}

function buildJwtAssertion(input: {
  integrationKey: string
  userId: string
  privateKey: string
  authBaseUrl: string
  expiresInSeconds?: number
}) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (input.expiresInSeconds || 3600)

  const header = { alg: "RS256", typ: "JWT" }
  const payload = {
    iss: input.integrationKey,
    sub: input.userId,
    aud: authHostFromBaseUrl(input.authBaseUrl),
    iat: now,
    exp,
    scope: "signature impersonation",
  }

  const encodedHeader = toBase64Url(JSON.stringify(header))
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const signer = crypto.createSign("RSA-SHA256")
  signer.update(signingInput)
  signer.end()

  let signature: Buffer
  try {
    signature = signer.sign(input.privateKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : "ukjent nøkkelfeil"
    throw new Error(
      `DocuSign private key kunne ikke brukes (${message}). Bekreft at nøkkelen er en RSA private key (PEM), ikke public key/cert, og bruk DOCUSIGN_PRIVATE_KEY eller DOCUSIGN_PRIVATE_KEY_PATH.`
    )
  }
  return `${signingInput}.${toBase64Url(signature)}`
}

async function getJwtAccessToken() {
  const cfg = await resolveJwtEnv()

  if (!cfg.integrationKey || !cfg.userId || !cfg.privateKey) {
    throw new Error(
      "DocuSign JWT config mangler. Sett DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID og DOCUSIGN_PRIVATE_KEY."
    )
  }

  const assertion = buildJwtAssertion(cfg)
  const tokenResponse = await fetch(`${cfg.authBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  })

  const tokenText = await tokenResponse.text()
  let tokenPayload: any = {}
  try {
    tokenPayload = tokenText ? JSON.parse(tokenText) : {}
  } catch {
    tokenPayload = { raw: tokenText }
  }

  if (!tokenResponse.ok || typeof tokenPayload?.access_token !== "string") {
    const reason =
      typeof tokenPayload?.error_description === "string"
        ? tokenPayload.error_description
        : typeof tokenPayload?.error === "string"
        ? tokenPayload.error
        : typeof tokenPayload?.raw === "string" && tokenPayload.raw
        ? tokenPayload.raw.slice(0, 200)
        : "token request failed"

    throw new Error(`DocuSign JWT auth feilet (${tokenResponse.status}): ${reason}`)
  }

  return {
    accessToken: tokenPayload.access_token as string,
    authBaseUrl: cfg.authBaseUrl,
  }
}

async function getUserInfo(accessToken: string, authBaseUrl: string) {
  const response = await fetch(`${authBaseUrl}/oauth/userinfo`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error("DocuSign userinfo request feilet")
  }

  return payload as { accounts?: DocusignAccount[] }
}

function normalizeBaseUri(baseUri: string) {
  if (!baseUri) return ""
  return baseUri.replace(/\/+$/, "")
}

function resolveAccount(accounts: DocusignAccount[]) {
  const preferred = process.env.DOCUSIGN_ACCOUNT_ID || ""

  const mapped = accounts.map((account) => ({
    accountId: String(account.account_id || account.accountId || ""),
    baseUri: String(account.base_uri || account.baseUri || ""),
    isDefault: Boolean(account.is_default || account.isDefault),
  }))

  if (preferred) {
    const match = mapped.find((item) => item.accountId === preferred)
    if (match) return match
  }

  return mapped.find((item) => item.isDefault) || mapped[0] || null
}

export async function getDocusignAuthContext(): Promise<DocusignAuthContext> {
  const legacyAccessToken = process.env.DOCUSIGN_ACCESS_TOKEN || ""
  const legacyAccountId = process.env.DOCUSIGN_ACCOUNT_ID || ""
  const legacyApiBase = process.env.DOCUSIGN_API_BASE_URL || ""

  const hasJwtIdentity = Boolean(process.env.DOCUSIGN_INTEGRATION_KEY && process.env.DOCUSIGN_USER_ID)
  const hasJwtKey = Boolean(process.env.DOCUSIGN_PRIVATE_KEY || process.env.DOCUSIGN_PRIVATE_KEY_PATH)
  const hasJwt = hasJwtIdentity && hasJwtKey

  if (!hasJwt) {
    if (!legacyAccessToken || !legacyAccountId || !legacyApiBase) {
      throw new Error(
        "DocuSign er ikke konfigurert. Bruk JWT best-practice (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_PRIVATE_KEY, DOCUSIGN_AUTH_BASE_URL)."
      )
    }

    return {
      accessToken: legacyAccessToken,
      accountId: legacyAccountId,
      baseUri: normalizeBaseUri(legacyApiBase),
    }
  }

  const { accessToken, authBaseUrl } = await getJwtAccessToken()
  const userInfo = await getUserInfo(accessToken, authBaseUrl)
  const account = resolveAccount(userInfo.accounts || [])

  if (!account?.accountId || !account?.baseUri) {
    throw new Error("Fant ikke gyldig DocuSign account/baseUri fra userinfo")
  }

  return {
    accessToken,
    accountId: account.accountId,
    baseUri: normalizeBaseUri(account.baseUri),
  }
}

export function getDocusignJwtConsentUrl() {
  const integrationKey = (process.env.DOCUSIGN_INTEGRATION_KEY || "").trim()
  if (!integrationKey) {
    throw new Error("DOCUSIGN_INTEGRATION_KEY mangler")
  }

  const authBaseUrl = normalizeAuthBaseUrl(process.env.DOCUSIGN_AUTH_BASE_URL || "https://account-d.docusign.com")
  const redirectUri = resolveRedirectUri()
  const scopes = ["signature", "impersonation"]

  const url = new URL(`${authBaseUrl}/oauth/auth`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", scopes.join(" "))
  url.searchParams.set("client_id", integrationKey)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("prompt", "consent")

  return url.toString()
}
