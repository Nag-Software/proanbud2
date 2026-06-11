export const TRIPLETEX_APPLICATION_NAME = process.env.TRIPLETEX_APPLICATION_NAME?.trim() || "Proanbud"

export const TRIPLETEX_HELP_URL =
  "https://hjelp.tripletex.no/hc/no/articles/16600381679249-Hvordan-oppretter-jeg-en-API-brukern%C3%B8kkel"

export function getTripletexConsumerToken() {
  const token = process.env.TRIPLETEX_CONSUMER_TOKEN?.trim()
  if (!token) {
    throw new Error("TRIPLETEX_CONSUMER_TOKEN is missing")
  }
  return token
}

export function hasTripletexConsumerToken() {
  return Boolean(process.env.TRIPLETEX_CONSUMER_TOKEN?.trim())
}

export function getTripletexApiBaseUrl() {
  return process.env.TRIPLETEX_BASE_URL?.trim() || "https://tripletex.no/v2"
}

export function normalizeTripletexApiKey(value: string) {
  return value.trim().replace(/\s+/g, "")
}

export function resolveTripletexConsumerToken() {
  return normalizeTripletexApiKey(getTripletexConsumerToken())
}

type WrappedTripletexToken = {
  token?: unknown
  tokenId?: unknown
}

export function decodeWrappedTripletexToken(value: string) {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8")
    const parsed = JSON.parse(decoded) as WrappedTripletexToken
    if (typeof parsed?.token === "string") {
      return parsed.token.trim()
    }
  } catch {
    return null
  }

  return null
}

export function inspectTripletexToken(value: string) {
  const normalized = normalizeTripletexApiKey(value)
  const innerToken = decodeWrappedTripletexToken(normalized)
  const tokenId =
    innerToken && normalized
      ? (() => {
          try {
            const parsed = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as WrappedTripletexToken
            return typeof parsed.tokenId === "number" ? parsed.tokenId : null
          } catch {
            return null
          }
        })()
      : null

  return {
    normalized,
    innerToken,
    tokenId,
    isTestToken: Boolean(innerToken?.startsWith("test-")),
    isProductionToken: Boolean(innerToken && !innerToken.startsWith("test-")),
  }
}

export function detectTripletexEnvironmentMismatch(consumerToken: string, employeeToken: string) {
  const consumer = inspectTripletexToken(consumerToken)
  const employee = inspectTripletexToken(employeeToken)
  const employeeInner = employee.innerToken || employee.normalized
  const consumerInner = consumer.innerToken || consumer.normalized

  if (consumerInner && employeeInner?.startsWith("test-") && !consumerInner.startsWith("test-")) {
    return {
      code: "tripletex_environment_mismatch" as const,
      message:
        "Dette er en test-API-nøkkel og kan ikke brukes med produksjons-consumer-token. Opprett en ny nøkkel på produksjons-Tripletex for Proanbud.no, eller bytt til test-miljø (api-test.tripletex.tech) med test-consumer-token.",
    }
  }

  if (consumerInner?.startsWith("test-") && employeeInner && !employeeInner.startsWith("test-")) {
    return {
      code: "tripletex_environment_mismatch" as const,
      message:
        "Produksjons-API-nøkkel kan ikke brukes med test-consumer-token. Bruk samme miljø for begge nøkler.",
    }
  }

  return null
}

export function isTripletexTestApiBaseUrl(baseUrl = getTripletexApiBaseUrl()) {
  return baseUrl.includes("api-test.tripletex.tech")
}

export function expandTripletexTokenCandidates(value: string) {
  const normalized = normalizeTripletexApiKey(value)
  if (!normalized) {
    return []
  }

  const candidates = [normalized]
  const innerToken = decodeWrappedTripletexToken(normalized)

  if (innerToken && !candidates.includes(innerToken)) {
    candidates.push(innerToken)
  }

  return candidates
}
