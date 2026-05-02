import { decryptSecret, encryptSecret } from "@/lib/integrations/tripletex/crypto"
import type {
  TripletexConnectionRow,
  TripletexCustomerPayload,
  TripletexProjectPayload,
} from "@/lib/integrations/tripletex/types"

type RequestMethod = "GET" | "POST" | "PUT"

type RequestOptions = {
  method?: RequestMethod
  path: string
  body?: Record<string, unknown>
}

const DEFAULT_TRIPLETEX_BASE_URL = "https://api.tripletex.io/v2"

function getTripletexBaseUrl() {
  return process.env.TRIPLETEX_BASE_URL || DEFAULT_TRIPLETEX_BASE_URL
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

    const reset = response.headers.get("x-rate-limit-reset")
    if (reset) {
      const resetMs = Number(reset) * 1000
      if (Number.isFinite(resetMs)) {
        error.rateLimitResetAt = new Date(resetMs).toISOString()
      }
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
  })

  return parseTripletexResponse(response)
}

export async function refreshTripletexSession(
  consumerToken: string,
  employeeToken: string,
  _existingSessionToken?: string | null
) {
  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() + 30)
  const expirationDateIso = expirationDate.toISOString().slice(0, 10)

  const response = await fetch(`${getTripletexBaseUrl()}/token/session/:create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      consumerToken,
      employeeToken,
      expirationDate: expirationDateIso,
    }),
    cache: "no-store",
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
