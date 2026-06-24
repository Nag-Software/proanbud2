import {
  expandTripletexTokenCandidates,
  getTripletexApiBaseUrl,
} from "@/lib/integrations/tripletex/config"
import {
  buildTripletexOfferExternalAccountsNumber,
  buildTripletexOfferNumber,
} from "@/lib/integrations/tripletex/offer-identity"
import { decryptSecret, encryptSecret } from "@/lib/integrations/tripletex/crypto"
import type {
  TripletexConnectionRow,
  TripletexCustomerPayload,
  TripletexProjectPayload,
} from "@/lib/integrations/tripletex/types"

type RequestMethod = "GET" | "POST" | "PUT" | "DELETE"

type RequestOptions = {
  method?: RequestMethod
  path: string
  body?: Record<string, unknown>
}

function getTripletexBaseUrl() {
  return getTripletexApiBaseUrl()
}

function authHeader(connection: TripletexConnectionRow) {
  const sessionToken = decryptSecret(connection.session_token_enc)

  if (!sessionToken) {
    throw new Error("Tripletex session token is missing")
  }

  // Tripletex API requests use Basic auth with username 0 (or client company id) and password session token.
  const composite = `0:${sessionToken}`
  const encoded = Buffer.from(composite).toString("base64")
  return `Basic ${encoded}`
}

async function parseTripletexResponse(response: Response) {
  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { value: text }
  }

  if (!response.ok) {
    const error = new Error(`Tripletex request failed (${response.status})`) as Error & {
      status?: number
      body?: any
      rateLimitResetAt?: string
    }
    error.status = response.status
    error.body = json

    // Prefer an explicit reset epoch if Tripletex sends one; otherwise honour the standard
    // HTTP `Retry-After` (delta-seconds), commonly returned on 429. If neither is present,
    // rateLimitResetAt stays undefined and the queue falls back to exponential backoff.
    const resetEpoch = response.headers.get("x-rate-limit-reset")
    const retryAfter = response.headers.get("retry-after")
    if (resetEpoch && Number.isFinite(Number(resetEpoch))) {
      error.rateLimitResetAt = new Date(Number(resetEpoch) * 1000).toISOString()
    } else if (retryAfter && Number.isFinite(Number(retryAfter))) {
      error.rateLimitResetAt = new Date(Date.now() + Number(retryAfter) * 1000).toISOString()
    }

    throw error
  }

  return json
}

export async function tripletexRequest(connection: TripletexConnectionRow, options: RequestOptions) {
  const url = `${getTripletexBaseUrl()}${options.path}`
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: authHeader(connection),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  })

  return parseTripletexResponse(response)
}

export async function refreshTripletexSessionWithCandidates(
  consumerToken: string,
  employeeTokenCandidates: string[]
) {
  if (employeeTokenCandidates.length === 0) {
    throw new Error("Tripletex employee token is missing")
  }

  let lastError: unknown = null

  for (const employeeToken of employeeTokenCandidates) {
    try {
      const session = await refreshTripletexSession(consumerToken, employeeToken)
      return {
        ...session,
        employeeToken,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

export async function refreshTripletexSession(
  consumerToken: string,
  employeeToken: string,
  _existingSessionToken?: string | null
) {
  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() + 30)
  const expirationDateIso = expirationDate.toISOString().slice(0, 10)

  const params = new URLSearchParams({
    consumerToken,
    employeeToken,
    expirationDate: expirationDateIso,
  })

  const sessionUrl = `${getTripletexBaseUrl()}/token/session/:create?${params.toString()}`

  if (process.env.NODE_ENV === "development") {
    console.info("[tripletex] creating session via PUT", getTripletexBaseUrl())
  }

  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  })

  const json = await parseTripletexResponse(response)
  const token = json?.value?.token || json?.value?.sessionToken || json?.value
  const expiresAt = json?.value?.expirationDate || json?.value?.expiresAt || null

  if (!token) {
    throw new Error("Tripletex session token missing in response")
  }

  return {
    sessionToken: String(token),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  }
}

export async function refreshTripletexSessionFromApiKey(consumerToken: string, apiKey: string) {
  return refreshTripletexSessionWithCandidates(consumerToken, expandTripletexTokenCandidates(apiKey))
}

export function encryptConnectionTokens(input: {
  consumerToken: string
  employeeToken: string
  sessionToken: string
}) {
  return {
    consumer_token_enc: encryptSecret(input.consumerToken),
    employee_token_enc: encryptSecret(input.employeeToken),
    session_token_enc: encryptSecret(input.sessionToken),
  }
}

export async function upsertTripletexCustomer(
  connection: TripletexConnectionRow,
  payload: TripletexCustomerPayload,
  externalId?: number
) {
  if (externalId) {
    return tripletexRequest(connection, {
      method: "PUT",
      path: `/customer/${externalId}`,
      body: payload,
    })
  }

  return tripletexRequest(connection, {
    method: "POST",
    path: "/customer",
    body: payload,
  })
}

function extractTripletexProjectIds(response: unknown): number[] {
  if (!response || typeof response !== "object") {
    return []
  }

  const record = response as Record<string, unknown>
  const values = record.values ?? record.value

  if (Array.isArray(values)) {
    return values
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null
        const id = Number((entry as Record<string, unknown>).id)
        return Number.isFinite(id) ? id : null
      })
      .filter((id): id is number => id !== null)
  }

  if (values && typeof values === "object") {
    const id = Number((values as Record<string, unknown>).id)
    return Number.isFinite(id) ? [id] : []
  }

  const directId = Number(record.id)
  return Number.isFinite(directId) ? [directId] : []
}

export async function findTripletexProjectOfferByProanbudId(
  connection: TripletexConnectionRow,
  offerId: string
): Promise<number | null> {
  const fields = "id,number,externalAccountsNumber,isOffer"
  const externalAccountsNumber = encodeURIComponent(buildTripletexOfferExternalAccountsNumber(offerId))
  const number = encodeURIComponent(buildTripletexOfferNumber(offerId))

  const byExternal = await tripletexRequest(connection, {
    path: `/project?externalAccountsNumber=${externalAccountsNumber}&isOffer=true&count=10&fields=${fields}`,
  })
  const externalMatch = extractTripletexProjectIds(byExternal)[0]
  if (externalMatch) {
    return externalMatch
  }

  const byNumber = await tripletexRequest(connection, {
    path: `/project?number=${number}&isOffer=true&count=10&fields=${fields}`,
  })
  return extractTripletexProjectIds(byNumber)[0] ?? null
}

export async function upsertTripletexProject(
  connection: TripletexConnectionRow,
  payload: TripletexProjectPayload,
  externalId?: number
) {
  if (externalId) {
    return tripletexRequest(connection, {
      method: "PUT",
      path: `/project/${externalId}`,
      body: payload,
    })
  }

  return tripletexRequest(connection, {
    method: "POST",
    path: "/project",
    body: payload,
  })
}

export async function getTripletexProjectFlags(connection: TripletexConnectionRow, projectId: number) {
  const response = await tripletexRequest(connection, {
    path: `/project/${projectId}?fields=id,isOffer`,
  })
  const value = response?.value ?? response
  if (!value || typeof value !== "object") {
    return null
  }

  return {
    isOffer: Boolean((value as Record<string, unknown>).isOffer),
  }
}

function extractTripletexOrderLineIds(response: unknown): number[] {
  if (!response || typeof response !== "object") {
    return []
  }

  const record = response as Record<string, unknown>
  const values = record.values ?? record.value

  if (!Array.isArray(values)) {
    return []
  }

  return values
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const id = Number((entry as Record<string, unknown>).id)
      return Number.isFinite(id) ? id : null
    })
    .filter((id): id is number => id !== null)
}

export async function listTripletexProjectOrderLineIds(
  connection: TripletexConnectionRow,
  projectId: number
) {
  const response = await tripletexRequest(connection, {
    path: `/project/orderline?projectId=${projectId}&count=1000&fields=id`,
  })
  return extractTripletexOrderLineIds(response)
}

export async function deleteTripletexProjectOrderLine(connection: TripletexConnectionRow, orderLineId: number) {
  await tripletexRequest(connection, {
    method: "DELETE",
    path: `/project/orderline/${orderLineId}`,
  })
}

/** Replace all order lines on a Tripletex tilbud (isOffer=true), never on utførelsesprosjekt. */
export async function replaceTripletexTilbudOrderLines(
  connection: TripletexConnectionRow,
  tilbudProjectId: number,
  lines: Record<string, unknown>[]
) {
  const flags = await getTripletexProjectFlags(connection, tilbudProjectId)
  if (!flags?.isOffer) {
    throw new Error(
      `Refusing to sync offer lines to Tripletex project ${tilbudProjectId}: expected tilbud (isOffer=true)`
    )
  }

  const existingLineIds = await listTripletexProjectOrderLineIds(connection, tilbudProjectId)

  // Create the new lines FIRST, then delete the old ones. If creation fails, the tilbud
  // keeps its previous lines instead of being left empty (delete-then-create would wipe a
  // customer-facing quote during the failure window). Each run captures the lines present
  // at its start and removes exactly those, so retries converge to just the new set.
  const created = lines.length > 0 ? await createTripletexProjectOrderLines(connection, lines) : null

  for (const lineId of existingLineIds) {
    await deleteTripletexProjectOrderLine(connection, lineId)
  }

  return created
}

export async function createTripletexProjectOrderLines(
  connection: TripletexConnectionRow,
  lines: Record<string, unknown>[]
) {
  if (lines.length === 0) {
    return null
  }

  if (lines.length === 1) {
    return tripletexRequest(connection, {
      method: "POST",
      path: "/project/orderline",
      body: lines[0],
    })
  }

  return tripletexRequest(connection, {
    method: "POST",
    path: "/project/orderline/list",
    body: lines as unknown as Record<string, unknown>,
  })
}

export async function upsertTripletexOrder(
  connection: TripletexConnectionRow,
  payload: Record<string, unknown>,
  externalId?: number
) {
  if (externalId) {
    return tripletexRequest(connection, {
      method: "PUT",
      path: `/order/${externalId}`,
      body: { ...payload, id: externalId },
    })
  }

  return tripletexRequest(connection, {
    method: "POST",
    path: "/order",
    body: payload,
  })
}

export async function createTripletexInvoiceFromOrder(
  connection: TripletexConnectionRow,
  orderExternalId: number,
  options?: { sendToCustomer?: boolean }
) {
  const invoiceDate = new Date().toISOString().slice(0, 10)
  const sendToCustomer = options?.sendToCustomer === true ? "TRUE" : "FALSE"

  return tripletexRequest(connection, {
    method: "PUT",
    path: `/order/${orderExternalId}/:invoice?invoiceDate=${invoiceDate}&sendToCustomer=${sendToCustomer}`,
  })
}

export async function getTripletexSessionEmployeeId(connection: TripletexConnectionRow) {
  const response = await tripletexRequest(connection, {
    path: "/token/session/>whoAmI",
  })

  const nestedEmployeeId = Number(response?.value?.employee?.id)
  if (Number.isFinite(nestedEmployeeId)) {
    return nestedEmployeeId
  }

  const altNestedEmployeeId = Number(response?.employee?.id)
  if (Number.isFinite(altNestedEmployeeId)) {
    return altNestedEmployeeId
  }

  return null
}

export async function uploadTripletexProjectDocument(
  connection: TripletexConnectionRow,
  projectExternalId: number,
  file: { name: string; bytes: Uint8Array; contentType: string }
) {
  const formData = new FormData()
  const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType })
  formData.append("file", blob, file.name)

  const url = `${getTripletexBaseUrl()}/documentArchive/project/${projectExternalId}`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(connection),
      Accept: "application/json",
    },
    body: formData,
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  })

  return parseTripletexResponse(response)
}

export async function createTripletexProjectActivity(
  connection: TripletexConnectionRow,
  payload: {
    projectExternalId: number
    title: string
    description?: string | null
    startDate: string
    endDate: string
  }
) {
  return tripletexRequest(connection, {
    method: "POST",
    path: "/project/projectActivity",
    body: {
      project: { id: payload.projectExternalId },
      activity: {
        name: payload.title.slice(0, 255),
        description: payload.description || undefined,
        activityType: "PROJECT_SPECIFIC_ACTIVITY",
        isProjectActivity: true,
      },
      startDate: payload.startDate,
      endDate: payload.endDate,
    },
  })
}

export async function getTripletexProjectManagerEmployeeIds(connection: TripletexConnectionRow): Promise<number[]> {
  const response = await tripletexRequest(connection, {
    path: "/project/onboarding/projectManagers?fields=employeeId",
  })

  const directValues = Array.isArray(response?.values) ? response.values : null
  const wrappedValues = Array.isArray(response?.value?.values) ? response.value.values : null
  const list: Array<{ employeeId?: unknown }> = (directValues || wrappedValues || []) as Array<{
    employeeId?: unknown
  }>

  const ids: number[] = list
    .map((entry) => Number(entry?.employeeId))
    .filter((id: number) => Number.isFinite(id))

  return Array.from(new Set(ids))
}
