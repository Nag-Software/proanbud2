import { describe, expect, it } from "vitest"

import {
  formatOsloDayMonth,
  formatOsloDayMonthTime,
  getOfferCustomerSignal,
  type OfferCustomerSignalInput,
} from "../../lib/tilbud/customer-signal"

function sendt(overstyr: Partial<OfferCustomerSignalInput> = {}): OfferCustomerSignalInput {
  return {
    status: "sent",
    sentAt: "2026-10-02T07:14:00Z",
    customerViewedAt: null,
    emailDeliveredAt: null,
    emailBouncedAt: null,
    ...overstyr,
  }
}

describe("signalet på sendte tilbud", () => {
  it("sier «Ikke åpnet» når vi ikke vet noe mer", () => {
    expect(getOfferCustomerSignal(sendt())).toEqual({ kind: "unopened", label: "Ikke åpnet", tone: "neutral" })
  })

  it("sier «Levert, ikke åpnet» først når Resend har meldt levering", () => {
    expect(getOfferCustomerSignal(sendt({ emailDeliveredAt: "2026-10-02T07:14:09Z" }))).toEqual({
      kind: "delivered",
      label: "Levert, ikke åpnet",
      tone: "neutral",
    })
  })

  it("sier «Kom ikke frem» når e-posten ble avvist", () => {
    expect(getOfferCustomerSignal(sendt({ emailBouncedAt: "2026-10-02T07:14:09Z" }))).toEqual({
      kind: "bounced",
      label: "Kom ikke frem",
      tone: "danger",
    })
  })

  it("lar «kom ikke frem» gå foran «levert» hvis begge er meldt", () => {
    const signal = getOfferCustomerSignal(
      sendt({ emailDeliveredAt: "2026-10-02T07:14:09Z", emailBouncedAt: "2026-10-02T07:15:00Z" })
    )
    expect(signal?.kind).toBe("bounced")
  })

  it("viser «Åpnet» med dato, og lar det gå foran alt annet", () => {
    const signal = getOfferCustomerSignal(
      sendt({
        customerViewedAt: "2026-10-03T12:12:00Z",
        emailDeliveredAt: "2026-10-02T07:14:09Z",
        emailBouncedAt: "2026-10-02T07:15:00Z",
      })
    )
    expect(signal).toEqual({ kind: "viewed", label: "Åpnet 3. okt", tone: "success" })
  })

  it("faller tilbake til bare «Åpnet» når tidspunktet er ugyldig", () => {
    expect(getOfferCustomerSignal(sendt({ customerViewedAt: "tull" }))?.label).toBe("Åpnet")
  })
})

describe("ingen signal når det ikke gir mening", () => {
  it.each(["draft", "accepted", "rejected", null, undefined])("status %s gir ikke signal", (status) => {
    expect(getOfferCustomerSignal(sendt({ status, customerViewedAt: "2026-10-03T12:12:00Z" }))).toBeNull()
  })

  it("et «sendt» tilbud uten sendetidspunkt gir ikke signal", () => {
    expect(getOfferCustomerSignal(sendt({ sentAt: null }))).toBeNull()
  })
})

// Serveren kjører UTC og nettleseren norsk tid. Etiketten må bli den samme
// begge steder, ellers gir React hydration-feil og kunden «åpnet» feil dag.
describe("datoer vises i norsk tid", () => {
  it("bruker norsk dato når UTC fortsatt er dagen før (sommertid, +2)", () => {
    expect(formatOsloDayMonth("2026-10-02T22:30:00Z")).toBe("3. okt")
    expect(formatOsloDayMonthTime("2026-10-02T22:30:00Z")).toBe("3. okt kl. 00.30")
  })

  it("bruker norsk dato når UTC fortsatt er dagen før (vintertid, +1)", () => {
    expect(formatOsloDayMonth("2026-12-31T23:30:00Z")).toBe("1. jan")
    expect(formatOsloDayMonthTime("2026-12-31T23:30:00Z")).toBe("1. jan kl. 00.30")
  })

  it("skriver klokkeslett med to sifre og punktum", () => {
    expect(formatOsloDayMonthTime("2026-10-02T07:04:00Z")).toBe("2. okt kl. 09.04")
  })

  it.each([
    ["2026-01-15T12:00:00Z", "15. jan"],
    ["2026-05-17T12:00:00Z", "17. mai"],
    ["2026-12-24T12:00:00Z", "24. des"],
  ])("%s blir «%s»", (iso, forventet) => {
    expect(formatOsloDayMonth(iso)).toBe(forventet)
  })

  it.each([null, undefined, "", "ikke en dato"])("gir tom streng for %s", (verdi) => {
    expect(formatOsloDayMonth(verdi)).toBe("")
    expect(formatOsloDayMonthTime(verdi)).toBe("")
  })
})
