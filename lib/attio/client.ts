// Tynn klient mot Attios REST-API (v2).
//
// Bare det synken trenger. Tre ting den tar seg av, så ingen kallsteder må:
//   - 429: Attio sier når grensen nullstilles (Retry-After). Vi venter og
//     prøver igjen, maks tre ganger — et begrenset kall er ikke utført, så det
//     er trygt å gjenta.
//   - Tidsavbrudd: et kall som henger, skal ikke spise en hel tick.
//   - Feil: kastes som AttioError med status og Attios egen kode, så synken kan
//     skille «nøkkelen er ugyldig» (stopp alt) fra «dette ene firmaet feilet».

const BASE_URL = "https://api.attio.com"
const TIMEOUT_MS = 15_000
const MAX_RETRIES = 3

export class AttioError extends Error {
  status: number
  code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = "AttioError"
    this.status = status
    this.code = code
  }

  /** Nøkkelen mangler, er ugyldig eller mangler tilgang — da feiler alt. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  /**
   * Et unikt felt kolliderer. Attio dokumenterer ikke koden for records, og
   * bruker både 400 og 409 med ulike koder andre steder — derfor bredt.
   */
  get isConflict(): boolean {
    if (this.code === "concurrent_write_conflict") return false
    return (
      this.code === "uniqueness_conflict" ||
      /unique/i.test(this.code ?? "") ||
      (this.status === 409 && this.code !== "slug_conflict") ||
      /unique|already (exists|in use)/i.test(this.message)
    )
  }
}

export function getAttioApiKey(): string | null {
  return process.env.ATTIO_API_KEY?.trim() || null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Hvor lenge vi skal vente etter en 429. Retry-After er en dato, eller sekunder. */
export function retryDelayMs(header: string | null, now: number = Date.now()): number {
  if (!header) return 1000
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1000))
  const at = Date.parse(header)
  if (Number.isNaN(at)) return 1000
  return Math.min(10_000, Math.max(0, at - now))
}

export async function attioRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const apiKey = getAttioApiKey()
  if (!apiKey) throw new AttioError("ATTIO_API_KEY er ikke satt", 401, "mangler_nokkel")

  const url = new URL(path, BASE_URL)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
        cache: "no-store",
      })
    } catch (error) {
      clearTimeout(timer)
      const aborted = error instanceof Error && error.name === "AbortError"
      throw new AttioError(aborted ? "Attio svarte ikke i tide" : "Kunne ikke nå Attio", 0, aborted ? "timeout" : "nettverk")
    }
    clearTimeout(timer)

    if (response.status === 429 && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(response.headers.get("retry-after")))
      continue
    }

    if (response.status === 204) return undefined as T

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const record = (payload ?? {}) as { message?: string; code?: string }
      throw new AttioError(
        record.message || `Attio svarte ${response.status}`,
        response.status,
        record.code ?? null,
      )
    }

    return payload as T
  }
}
