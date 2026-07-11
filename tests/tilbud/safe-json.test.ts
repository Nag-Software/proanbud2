import { describe, expect, it } from "vitest"

import { apiErrorMessage, parseJsonResponse } from "@/lib/http/safe-json"

describe("parseJsonResponse", () => {
  it("parser gyldig JSON", async () => {
    const response = new Response(JSON.stringify({ phase: "result" }), { status: 200 })
    await expect(parseJsonResponse(response)).resolves.toEqual({ phase: "result" })
  })

  it("returnerer null for Vercel-timeoutens rentekst-side i stedet for å kaste", async () => {
    // Den faktiske kundefeilen: «Unexpected token 'A', "An error o"... is not valid JSON»
    const response = new Response("An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT", {
      status: 504,
    })
    await expect(parseJsonResponse(response)).resolves.toBeNull()
  })

  it("returnerer null for tom body", async () => {
    const response = new Response("", { status: 502 })
    await expect(parseJsonResponse(response)).resolves.toBeNull()
  })
})

describe("apiErrorMessage", () => {
  it("bruker serverens norske melding når den finnes", () => {
    expect(
      apiErrorMessage({ status: 400, serverMessage: "Oppdraget inneholder for mye data.", fallback: "Feilet." })
    ).toBe("Oppdraget inneholder for mye data.")
  })

  it("skjuler rå OpenAI-feil for bruker", () => {
    const message = apiErrorMessage({
      status: 500,
      serverMessage: 'OpenAI 400: { "error": { "code": "context_length_exceeded" } }',
      fallback: "Kalkylen feilet. Prøv igjen.",
    })
    expect(message).toBe("Kalkylen feilet. Prøv igjen.")
  })

  it("gir tidsavbrudd-melding for 504 uten JSON-body", () => {
    const message = apiErrorMessage({ status: 504, serverMessage: null, fallback: "Feilet." })
    expect(message).toContain("for lang tid")
  })
})
