import crypto from "crypto"

import {
  FIKEN_OAUTH_TOKEN_URL,
  getFikenApiBaseUrl,
  getFikenRedirectUri,
  getFikenTokenBasicAuthHeader,
} from "@/lib/integrations/fiken/config"
import { decryptSecret } from "@/lib/integrations/shared/crypto"
import type {
  FikenCompanyRead,
  FikenConnectionRow,
  FikenContactPayload,
  FikenInvoiceRead,
  FikenInvoiceRequest,
  FikenProjectPayload,
} from "@/lib/integrations/fiken/types"

type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type FikenResponse = {
  status: number
  json: any
  /** Numeric id parsed from the 201/200 `Location` header (POST/PUT bodies are empty). */
  locationId: number | null
  location: string | null
  headers: Headers
}

export type FikenKnownError = Error & {
  status?: number
  body?: unknown
  rateLimitResetAt?: string
}

// --- Rate pacing ------------------------------------------------------------
// Fiken allows only ONE concurrent request per credential and throttles above
// ~4 req/s; repeat concurrency violations get the credential BANNED. We serialize
// every request through a single promise chain and keep a minimum gap between them.
// This is the per-instance guard; cross-invocation serialization is the DB worker lock.
const MIN_REQUEST_GAP_MS = 300

// Chain every request through a single tail so at most one Fiken call is in flight
// per instance, with a fixed gap after each to stay under ~4 req/s.
let serialTail: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = serialTail.then(fn, fn)
  serialTail = result
    .catch(() => undefined)
    .then(() => new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_GAP_MS)))
  return result
}

// --- Response parsing -------------------------------------------------------
function parseLocationId(location: string | null): number | null {
  if (!location) return null
  const match = location.match(/(\d+)(?:\/?$)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) ? id : null
}

async function parseFikenResponse(response: Response): Promise<FikenResponse> {
  const text = await response.text()
  let json: any = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { value: text }
    }
  }

  const location = response.headers.get("location")

  if (!response.ok) {
    const error = new Error(`Fiken request failed (${response.status})`) as FikenKnownError
    error.status = response.status
    error.body = json
    // Fiken documents no Retry-After header. On 429 we back off via job scheduling.
    throw error
  }

  return {
    status: response.status,
    json,
    location,
    locationId: parseLocationId(location),
    headers: response.headers,
  }
}

// --- Token resolution -------------------------------------------------------
export function resolveFikenAccessToken(connection: FikenConnectionRow): string {
  const token =
    connection.auth_mode === "personal"
      ? decryptSecret(connection.personal_token_enc)
      : decryptSecret(connection.access_token_enc)

  if (!token) {
    throw new Error("Fiken access token is missing")
  }
  return token
}

// --- Low-level requests -----------------------------------------------------
export async function fikenRawRequest(input: {
  accessToken: string
  method?: RequestMethod
  path: string
  body?: Record<string, unknown>
}): Promise<FikenResponse> {
  return serialize(async () => {
    const url = `${getFikenApiBaseUrl()}${input.path}`
    const response = await fetch(url, {
      method: input.method || "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // Fiken anbefaler denne på alle kall; gjør feilsøking mot supporten deres mulig.
        "X-Request-ID": crypto.randomUUID(),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    })
    return parseFikenResponse(response)
  })
}

export async function fikenRequest(
  connection: FikenConnectionRow,
  options: { method?: RequestMethod; path: string; body?: Record<string, unknown> }
): Promise<FikenResponse> {
  return fikenRawRequest({
    accessToken: resolveFikenAccessToken(connection),
    method: options.method,
    path: options.path,
    body: options.body,
  })
}

function companyPath(connection: FikenConnectionRow, suffix: string) {
  const slug = connection.fiken_company_slug
  if (!slug) {
    throw new Error("Fiken company slug is missing on connection")
  }
  return `/companies/${encodeURIComponent(slug)}${suffix}`
}

// --- OAuth2 -----------------------------------------------------------------
type FikenTokenResponse = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
}

async function postFikenToken(form: Record<string, string>): Promise<FikenTokenResponse> {
  const response = await fetch(FIKEN_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: getFikenTokenBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  })

  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    const message = json?.error_description || json?.error || `Fiken token request failed (${response.status})`
    const error = new Error(String(message)) as FikenKnownError
    error.status = response.status
    error.body = json
    throw error
  }

  const accessToken = json?.access_token
  if (!accessToken) {
    throw new Error("Fiken token response missing access_token")
  }

  const expiresInSeconds = Number(json?.expires_in)
  const expiresAt = Number.isFinite(expiresInSeconds)
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : null

  return {
    accessToken: String(accessToken),
    refreshToken: json?.refresh_token ? String(json.refresh_token) : null,
    expiresAt,
    scope: json?.scope ? String(json.scope) : null,
  }
}

export async function exchangeFikenCode(code: string, codeVerifier?: string | null) {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: getFikenRedirectUri(),
  }
  if (codeVerifier) {
    form.code_verifier = codeVerifier
  }
  return postFikenToken(form)
}

export async function refreshFikenAccessToken(refreshToken: string) {
  return postFikenToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
}

// --- Companies (used during OAuth callback, before a connection row exists) --
export async function getFikenCompanies(accessToken: string): Promise<FikenCompanyRead[]> {
  const response = await fikenRawRequest({
    accessToken,
    path: "/companies?page=0&pageSize=100",
  })
  const json = response.json
  if (Array.isArray(json)) {
    return json as FikenCompanyRead[]
  }
  if (json && Array.isArray(json.data)) {
    return json.data as FikenCompanyRead[]
  }
  return []
}

// --- Contacts ---------------------------------------------------------------
export async function createFikenContact(connection: FikenConnectionRow, payload: FikenContactPayload) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/contacts"),
    body: payload,
  })
}

export async function updateFikenContact(
  connection: FikenConnectionRow,
  contactId: number,
  payload: FikenContactPayload
) {
  return fikenRequest(connection, {
    method: "PUT",
    path: companyPath(connection, `/contacts/${contactId}`),
    body: payload,
  })
}

export async function findFikenContactByOrgNumber(
  connection: FikenConnectionRow,
  organizationNumber: string
): Promise<number | null> {
  const response = await fikenRequest(connection, {
    path: companyPath(
      connection,
      `/contacts?organizationNumber=${encodeURIComponent(organizationNumber)}&page=0&pageSize=10`
    ),
  })
  const list = Array.isArray(response.json) ? response.json : []
  const first = list.find((row) => Number.isFinite(Number((row as Record<string, unknown>)?.contactId)))
  const id = first ? Number((first as Record<string, unknown>).contactId) : null
  return Number.isFinite(id as number) ? (id as number) : null
}

// --- Projects ---------------------------------------------------------------
export async function createFikenProject(connection: FikenConnectionRow, payload: FikenProjectPayload) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/projects"),
    body: payload,
  })
}

export async function updateFikenProject(
  connection: FikenConnectionRow,
  projectId: number,
  payload: Partial<FikenProjectPayload>
) {
  return fikenRequest(connection, {
    method: "PATCH",
    path: companyPath(connection, `/projects/${projectId}`),
    body: payload,
  })
}

// --- Offers (tilbud): draft -> createOffer ----------------------------------
export async function createFikenOfferDraft(connection: FikenConnectionRow, draft: Record<string, unknown>) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/offers/drafts"),
    body: draft,
  })
}

export async function createFikenOfferFromDraft(connection: FikenConnectionRow, draftId: number) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, `/offers/drafts/${draftId}/createOffer`),
  })
}

// --- Invoices: draft -> createInvoice, or direct -----------------------------
export async function createFikenInvoiceDraft(connection: FikenConnectionRow, draft: Record<string, unknown>) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/invoices/drafts"),
    body: draft,
  })
}

export async function createFikenInvoiceFromDraft(connection: FikenConnectionRow, draftId: number) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, `/invoices/drafts/${draftId}/createInvoice`),
  })
}

export async function createFikenInvoiceDirect(connection: FikenConnectionRow, payload: FikenInvoiceRequest) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/invoices"),
    body: payload as unknown as Record<string, unknown>,
  })
}

/** Slett et fakturautkast i Fiken (DELETE /invoices/drafts/{draftId}). */
export async function deleteFikenInvoiceDraft(connection: FikenConnectionRow, draftId: number) {
  return fikenRequest(connection, {
    method: "DELETE",
    path: companyPath(connection, `/invoices/drafts/${draftId}`),
  })
}

/**
 * DELETE /offers/drafts/{id}
 *
 * Egen funksjon fordi tilbud og faktura har HVER SIN kladd-ressurs i Fiken, med hver
 * sin id-serie. Å slette en tilbudskladd via /invoices/drafts ville i beste fall gitt
 * 404 — og i verste fall truffet en helt annen fakturakladd med samme tall.
 */
export async function deleteFikenOfferDraft(connection: FikenConnectionRow, draftId: number) {
  return fikenRequest(connection, {
    method: "DELETE",
    path: companyPath(connection, `/offers/drafts/${draftId}`),
  })
}

/**
 * Bankkontoene Fiken kjenner for firmaet.
 *
 * Vi trenger `bankAccountNumber` (selve kontonummeret) — det er feltet et fakturautkast
 * godtar. `accountCode` («1920:XXXXX») hører til andre endepunkter og virker ikke her.
 */
export async function listFikenBankAccounts(connection: FikenConnectionRow) {
  const response = await fikenRequest(connection, {
    path: companyPath(connection, "/bankAccounts?page=0&pageSize=100"),
  })
  const json = response.json
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
  return rows as Array<{
    name?: string
    accountCode?: string
    bankAccountNumber?: string
    inactive?: boolean
  }>
}

/**
 * Finn fakturaen som ble opprettet fra et gitt utkast.
 *
 * `invoiceDraftUuid` er et dokumentert filter på GET /invoices. Dette er nøkkelen til å
 * gjøre en TVETYDIG ferdigstilling trygg: feiler `createInvoiceFromDraft` med
 * nettverksfeil eller 5xx, vet vi ikke om Fiken rakk å opprette fakturaen. I stedet for
 * å dead-letter'e og be om manuell opprydding, kan vi spørre — og enten koble opp den
 * ekte fakturaen eller slå fast at ingen finnes.
 */
export async function findFikenInvoiceByDraftUuid(
  connection: FikenConnectionRow,
  draftUuid: string
): Promise<{ invoiceId: number } | null> {
  const response = await fikenRequest(connection, {
    path: companyPath(connection, `/invoices?invoiceDraftUuid=${encodeURIComponent(draftUuid)}&page=0&pageSize=1`),
  })
  const json = response.json
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
  const first = rows[0] as { invoiceId?: number } | undefined
  return first?.invoiceId ? { invoiceId: first.invoiceId } : null
}

/**
 * Nummerserier («counters») for tilbud og faktura.
 *
 * Fiken nekter å ferdigstille det FØRSTE dokumentet av en type før nummerserien finnes:
 *   faktura: «Missing number series for drafts of type: invoice…»
 *   tilbud:  «Offer counter not initialized for this company…»
 *
 * Fikens egen feiltekst ber deg opprette dokumentet manuelt i Fiken Web, men API-et har
 * et endepunkt for nettopp dette. Tom body gir basisnummer 10000, altså første dokument
 * 10001 — samme standard som Fiken Web bruker. Vi initialiserer derfor selv, slik at
 * kunden aldri må innom fiken.no for å komme i gang.
 */
export async function createFikenInvoiceCounter(connection: FikenConnectionRow) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/invoices/counter"),
    body: {},
  })
}

export async function createFikenOfferCounter(connection: FikenConnectionRow) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/offers/counter"),
    body: {},
  })
}

export async function sendFikenInvoice(connection: FikenConnectionRow, payload: Record<string, unknown>) {
  return fikenRequest(connection, {
    method: "POST",
    path: companyPath(connection, "/invoices/send"),
    body: payload,
  })
}

// --- Invoices (payment polling) ---------------------------------------------
// We poll settled invoices (not sales): invoiceResult.invoiceId is the id we persist
// in external_entity_links, so we can map a paid invoice straight back to the offer.
export async function listFikenSettledInvoices(
  connection: FikenConnectionRow,
  input: { sinceDate?: string | null; page: number; pageSize?: number }
): Promise<{ items: FikenInvoiceRead[]; pageCount: number }> {
  const pageSize = input.pageSize ?? 100
  const params = new URLSearchParams({
    settled: "true",
    page: String(input.page),
    pageSize: String(pageSize),
  })
  if (input.sinceDate) {
    params.set("lastModifiedGe", input.sinceDate)
  }

  const response = await fikenRequest(connection, {
    path: companyPath(connection, `/invoices?${params.toString()}`),
  })

  const items = Array.isArray(response.json) ? (response.json as FikenInvoiceRead[]) : []
  const pageCount = Number(response.headers.get("Fiken-Api-Page-Count") || "1")
  return { items, pageCount: Number.isFinite(pageCount) ? pageCount : 1 }
}

// --- Attachments / inbox ----------------------------------------------------
export async function uploadFikenInvoiceAttachment(
  connection: FikenConnectionRow,
  invoiceId: number,
  file: { name: string; bytes: Uint8Array; contentType: string }
) {
  return serialize(async () => {
    const accessToken = resolveFikenAccessToken(connection)
    const formData = new FormData()
    const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType })
    formData.append("filename", file.name)
    formData.append("file", blob, file.name)

    const url = `${getFikenApiBaseUrl()}${companyPath(connection, `/invoices/${invoiceId}/attachments`)}`
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    })
    return parseFikenResponse(response)
  })
}

export async function uploadFikenInboxDocument(
  connection: FikenConnectionRow,
  file: { name: string; description?: string; bytes: Uint8Array; contentType: string }
) {
  return serialize(async () => {
    const accessToken = resolveFikenAccessToken(connection)
    const formData = new FormData()
    const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType })
    formData.append("name", file.name)
    formData.append("filename", file.name)
    if (file.description) {
      formData.append("description", file.description)
    }
    formData.append("file", blob, file.name)

    const url = `${getFikenApiBaseUrl()}${companyPath(connection, "/inbox")}`
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    })
    return parseFikenResponse(response)
  })
}

/**
 * GET /contacts?customer=true — kundeimport fra Fiken.
 *
 * Fiken sideler med `page` (0-indeksert) + `pageSize` (maks 100), og BEGGE må
 * settes for at sidedelingen skal slå inn. Kall serielt: Fiken tåler kun én
 * samtidig forespørsel per credential.
 */
export async function listFikenContacts(
  connection: FikenConnectionRow,
  input: { page: number; pageSize?: number }
) {
  const pageSize = Math.min(input.pageSize ?? 100, 100)
  const response = await fikenRequest(connection, {
    path: companyPath(
      connection,
      `/contacts?customer=true&page=${input.page}&pageSize=${pageSize}`
    ),
  })
  return Array.isArray(response.json) ? (response.json as Record<string, unknown>[]) : []
}

/**
 * GET /timeUsers — Fikens motstykke til Tripletex' ansatte.
 *
 * MERK: dette er en LESE-only ressurs. Fiken har intet endepunkt for å opprette
 * en timebruker, så personen må finnes i Fiken fra før; vi kan bare koble den mot
 * en ProAnbud-bruker på e-post. Det er også grunnen til at ansatt-koblingen har en
 * manuell utvei i UI-et.
 */
export async function listFikenTimeUsers(
  connection: FikenConnectionRow,
  input: { page: number; pageSize?: number }
) {
  const pageSize = Math.min(input.pageSize ?? 100, 100)
  const response = await fikenRequest(connection, {
    path: companyPath(connection, `/timeUsers?page=${input.page}&pageSize=${pageSize}`),
  })
  return Array.isArray(response.json) ? (response.json as Record<string, unknown>[]) : []
}
