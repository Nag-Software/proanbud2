// Tynn klient mot Resends kontakt-, segment- og event-API.
//
// Bruker fetch direkte i stedet for SDK-en: resend@6.9 i package.json mangler
// events.send, og vi trenger bare en håndfull endepunkter. Håndterer 429 med
// ett nytt forsøk etter Retry-After, så en backfill ikke stopper på rate limit.

const BASE_URL = "https://api.resend.com"

export class ResendApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message)
    this.name = "ResendApiError"
  }
}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY mangler")
  return key
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 429 && attempt < 2) {
    const retryAfter = Number(res.headers.get("retry-after")) || 1
    await sleep(retryAfter * 1000)
    return request<T>(method, path, body, attempt + 1)
  }

  const text = await res.text()
  const json = text ? safeJson(text) : null
  if (!res.ok) {
    const apiMessage =
      json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : ""
    const message = apiMessage || `Resend ${method} ${path} feilet med ${res.status}`
    throw new ResendApiError(message, res.status, json)
  }
  return json as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const enc = encodeURIComponent

export type ContactProperties = Record<string, string | number | null>

export type ContactInput = {
  email: string
  firstName?: string | null
  properties: ContactProperties
}

/** Oppdaterer kontakten, eller oppretter den (med segmenter) hvis den ikke finnes. Returnerer true hvis ny. */
export async function upsertContact(input: ContactInput, segmentIdsOnCreate: string[]): Promise<boolean> {
  try {
    await request("PATCH", `/contacts/${enc(input.email)}`, {
      first_name: input.firstName ?? undefined,
      properties: input.properties,
    })
    return false
  } catch (err) {
    if (!(err instanceof ResendApiError) || err.status !== 404) throw err
  }
  await request("POST", "/contacts", {
    email: input.email,
    first_name: input.firstName ?? undefined,
    properties: input.properties,
    segments: segmentIdsOnCreate.map((id) => ({ id })),
  })
  return true
}

export async function addToSegment(email: string, segmentId: string): Promise<void> {
  await request("POST", `/contacts/${enc(email)}/segments/${enc(segmentId)}`)
}

export async function removeFromSegment(email: string, segmentId: string): Promise<void> {
  try {
    await request("DELETE", `/contacts/${enc(email)}/segments/${enc(segmentId)}`)
  } catch (err) {
    // Var ikke medlem / kontakten finnes ikke — målet er nådd uansett.
    if (err instanceof ResendApiError && err.status === 404) return
    throw err
  }
}

export async function sendEvent(event: string, email: string, payload: Record<string, unknown>): Promise<void> {
  await request("POST", "/events/send", { event, email, payload })
}

type SegmentList = { data?: { id: string; name: string }[] }

let segmentCache: { at: number; byName: Map<string, string> } | null = null

/** Segment-ID-er slått opp på navn (opprettet av scripts/resend-crm-setup.mjs). Cachet i 10 min. */
export async function getSegmentIdsByName(): Promise<Map<string, string>> {
  if (segmentCache && Date.now() - segmentCache.at < 10 * 60 * 1000) return segmentCache.byName
  const list = await request<SegmentList>("GET", "/segments?limit=100")
  const byName = new Map((list.data ?? []).map((s) => [s.name, s.id]))
  segmentCache = { at: Date.now(), byName }
  return byName
}
