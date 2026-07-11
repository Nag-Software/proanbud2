// Trygg parsing av API-svar i klientkode. Når en serverless-funksjon dør
// (timeout, krasj, 413 fra proxy) svarer Vercel med ren tekst («An error
// occurred with your deployment…»), ikke JSON. `response.json()` kaster da
// «Unexpected token 'A' …» — en råtekst-feil brukeren aldri skal se.
// Denne leser body som tekst, forsøker JSON.parse, og lar kallstedet håndtere
// null + status med en forståelig norsk melding i stedet.

export async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const raw = await response.text().catch(() => "")
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Standard norsk feilmelding for et API-svar som feilet eller ikke var JSON.
 * Bruk serverens egen melding når den finnes (rutene svarer på norsk), ellers
 * en statusbasert fallback.
 */
export function apiErrorMessage(input: {
  status: number
  serverMessage?: string | null
  fallback: string
}): string {
  const serverMessage = input.serverMessage?.trim()
  // Ikke vis rå tekniske meldinger (engelske API-feil, parse-støy) til bruker.
  if (serverMessage && !/^(OpenAI|Unexpected token|SyntaxError|Error:)/i.test(serverMessage)) {
    return serverMessage
  }

  if (input.status === 504 || input.status === 502 || input.status === 503) {
    return "Tjenesten brukte for lang tid på å svare. Prøv igjen – det går som regel bra på nytt forsøk."
  }

  if (input.status === 413) {
    return "Filen eller forespørselen er for stor. Prøv med mindre vedlegg."
  }

  if (input.status === 429) {
    return "For mange forespørsler på kort tid. Vent litt og prøv igjen."
  }

  return input.fallback
}
