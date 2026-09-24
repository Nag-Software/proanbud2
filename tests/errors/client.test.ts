import { describe, expect, it } from "vitest"

import { buildClientErrorPayload, actionErrorMessage } from "@/lib/errors/client"

// Payloaden går gjennom JSON.stringify før den sendes — test det serveren faktisk mottar.
function roundTrip(payload: unknown) {
  return JSON.parse(JSON.stringify(payload))
}

describe("buildClientErrorPayload", () => {
  it("beholder message og stack fra Error (ikke-enumerable felt)", () => {
    const error = new Error("Tjenesten brukte for lang tid på å svare.")
    const payload = roundTrip(buildClientErrorPayload(error, { context: { action: "ai-chat start phase" } }, "/nytt-tilbud"))

    expect(payload.message).toBe("Tjenesten brukte for lang tid på å svare.")
    expect(typeof payload.stack).toBe("string")
    expect(payload.route).toBe("/nytt-tilbud")
    expect(payload.context).toEqual({ action: "ai-chat start phase" })
  })

  it("bruker feilnavnet når Error mangler melding", () => {
    const payload = roundTrip(buildClientErrorPayload(new TypeError("")))
    expect(payload.message).toBe("TypeError")
  })

  it("faller tilbake til standardmelding for ukjent input", () => {
    expect(buildClientErrorPayload(undefined).message).toBe("Ukjent klientfeil")
    expect(buildClientErrorPayload({ message: "   " }).message).toBe("Ukjent klientfeil")
  })

  it("godtar vanlige rapport-objekter og strenger", () => {
    expect(buildClientErrorPayload({ message: "Lagring feilet", level: "warning" })).toMatchObject({
      message: "Lagring feilet",
      level: "warning",
    })
    expect(buildClientErrorPayload("Noe gikk galt").message).toBe("Noe gikk galt")
  })

  it("kutter message og stack til grensene i /api/errors", () => {
    const error = new Error("x".repeat(5000))
    error.stack = "s".repeat(20000)
    const payload = buildClientErrorPayload(error)
    expect(payload.message).toHaveLength(2000)
    expect(payload.stack).toHaveLength(8000)
  })
})

describe("actionErrorMessage", () => {
  it("viser egne feilmeldinger", () => {
    expect(actionErrorMessage(new Error("Prosjektet finnes ikke"), "Noe gikk galt")).toBe("Prosjektet finnes ikke")
  })

  it("bytter ut Next.js' skjulte produksjonsfeil med norsk tekst", () => {
    const redacted = Object.assign(
      new Error(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details."
      ),
      { digest: "123" }
    )
    expect(actionErrorMessage(redacted, "Kunne ikke lagre")).toBe("Kunne ikke lagre")
  })

  it("bruker reserveteksten for ukjente verdier og tomme meldinger", () => {
    expect(actionErrorMessage("oops", "Kunne ikke lagre")).toBe("Kunne ikke lagre")
    expect(actionErrorMessage(new Error("  "), "Kunne ikke lagre")).toBe("Kunne ikke lagre")
  })
})
