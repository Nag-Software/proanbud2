// Minimal robust wrapper rundt OpenAI HTTP-kall: timeout + retry med
// eksponentiell backoff på transiente feil (429 rate limit / 5xx). Holder
// prompt- og body-logikk på kallstedet — bytt ut rå `fetch(...)` med dette.
//
// Bruk:
//   const res = await openaiFetch("chat/completions", { model, messages, ... })
//   const data = await res.json()
//
// Kaster på manglende API-nøkkel, på klientfeil (4xx unntatt 429), og når alle
// forsøk er brukt opp. Returnerer kun en `ok` Response.

type OpenAiFetchOptions = {
  /** Antall ekstra forsøk etter første (default 2 → opptil 3 kall totalt). */
  retries?: number
  /** Timeout per forsøk i millisekunder (default 30s). */
  timeoutMs?: number
}

export async function openaiFetch(
  path: string,
  body: unknown,
  options: OpenAiFetchOptions = {},
): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY mangler")

  const retries = options.retries ?? 2
  const timeoutMs = options.timeoutMs ?? 30000
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Eksponentiell backoff: 500ms, 1000ms, 2000ms ...
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
    }

    let response: Response
    try {
      response = await fetch(`https://api.openai.com/v1/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      // Nettverksfeil eller timeout (AbortError) — prøv igjen.
      lastError = error
      continue
    }

    if (response.ok) return response

    const detail = await response.text().catch(() => "")
    const error = new Error(`OpenAI ${response.status}: ${detail}`)
    // 429 (rate limit) og 5xx er transiente; øvrige 4xx er klientfeil det ikke
    // er noen vits i å gjenta.
    if (response.status !== 429 && response.status < 500) throw error
    lastError = error
  }

  console.error("[openaiFetch] ga opp etter gjentatte forsøk:", lastError)
  throw lastError instanceof Error ? lastError : new Error("OpenAI-kall feilet")
}
