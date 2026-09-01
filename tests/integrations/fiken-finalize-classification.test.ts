import { describe, expect, it } from "vitest"

import {
  isAmbiguousFikenFailure,
  isDraftMissingBankAccount,
  isMissingNumberSeries,
} from "../../lib/integrations/fiken/failure-classification"

function fikenError(status: number | undefined, body?: unknown) {
  const error = new Error(`Fiken request failed (${status})`) as Error & {
    status?: number
    body?: unknown
  }
  if (status !== undefined) error.status = status
  error.body = body
  return error
}

// Bakgrunn: ALLE finalize-feil ble tidligere dead-letter'et som «ambiguous_create».
// Det er bare riktig når Fiken KAN ha rukket å opprette dokumentet. En HTTP 400 er en
// ren avvisning — ingenting ble opprettet — og skal kunne kjøres om igjen.
describe("isAmbiguousFikenFailure", () => {
  it("nettverksfeil uten status er tvetydig — requesten kan ha nådd fram", () => {
    expect(isAmbiguousFikenFailure(new Error("fetch failed"))).toBe(true)
    expect(isAmbiguousFikenFailure(fikenError(undefined))).toBe(true)
  })

  it("5xx og timeout er tvetydig", () => {
    expect(isAmbiguousFikenFailure(fikenError(500))).toBe(true)
    expect(isAmbiguousFikenFailure(fikenError(502))).toBe(true)
    expect(isAmbiguousFikenFailure(fikenError(503))).toBe(true)
    expect(isAmbiguousFikenFailure(fikenError(408))).toBe(true)
  })

  it("4xx er en ren avvisning — ingenting ble opprettet", () => {
    expect(isAmbiguousFikenFailure(fikenError(400))).toBe(false)
    expect(isAmbiguousFikenFailure(fikenError(401))).toBe(false)
    expect(isAmbiguousFikenFailure(fikenError(403))).toBe(false)
    expect(isAmbiguousFikenFailure(fikenError(404))).toBe(false)
    expect(isAmbiguousFikenFailure(fikenError(422))).toBe(false)
  })
})

describe("isMissingNumberSeries", () => {
  it("kjenner igjen Fikens faktura-melding", () => {
    expect(
      isMissingNumberSeries(
        fikenError(400, {
          message:
            "Missing number series for drafts of type: invoice. In order to begin a number series please create the first draft in Fiken Web instead of via the API.",
        })
      )
    ).toBe(true)
  })

  it("kjenner igjen Fikens tilbud-melding", () => {
    expect(
      isMissingNumberSeries(
        fikenError(400, {
          message:
            "Offer counter not initialized for this company, create an offer in Fiken to set base number OR use POST /offers/counter to set the base number",
        })
      )
    ).toBe(true)
  })

  it("slår ikke ut på urelaterte feil", () => {
    expect(
      isMissingNumberSeries(
        fikenError(400, { message: "incomeAccount is required for free-text lines (lines without a productId)" })
      )
    ).toBe(false)
    expect(
      isMissingNumberSeries(
        fikenError(400, {
          message: "VAT charged when the company is not VAT registered. The only VAT type accepted is OUTSIDE.",
        })
      )
    ).toBe(false)
    expect(isMissingNumberSeries(fikenError(500))).toBe(false)
  })
})

// Skillet her avgjør om vi lager kladden på nytt eller gir opp. Bommer vi, får vi enten
// en evig løkke eller en jobb som aldri kan lykkes.
describe("isDraftMissingBankAccount", () => {
  it("kjenner igjen kladd laget FØR bankkontoen ble valgt", () => {
    expect(
      isDraftMissingBankAccount(
        fikenError(403, {
          message:
            "The bank account number null has not been verified as belonging to this company. Create one invoice from this bank account in Fiken first",
        })
      )
    ).toBe(true)
  })

  it("skiller den fra Altinn-porten — der hjelper det IKKE å lage kladden på nytt", () => {
    expect(
      isDraftMissingBankAccount(
        fikenError(403, {
          message:
            "The bank account number 98024281914 has not been verified as belonging to this company. Create one invoice from this bank account in Fiken first",
        })
      )
    ).toBe(false)
  })

  it("slår ikke ut på urelaterte feil", () => {
    expect(isDraftMissingBankAccount(fikenError(404, { message: "No invoice draft found with provided id." }))).toBe(
      false
    )
    expect(isDraftMissingBankAccount(fikenError(500))).toBe(false)
  })
})
