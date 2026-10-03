import { describe, expect, it } from "vitest"

import {
  classifyOfferEmailEvent,
  isScannerUserAgent,
  OFFER_EVENT_RETRY_WINDOW_MS,
  shouldCountCustomerView,
  shouldResetCustomerView,
  shouldRetryUnmatchedOfferEvent,
} from "../../lib/tilbud/offer-tracking.shared"

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

function visning(overstyr: Partial<Parameters<typeof shouldCountCustomerView>[0]> = {}) {
  return shouldCountCustomerView({
    userAgent: SAFARI,
    viewerCompanyId: null,
    offerCompanyId: "firma-a",
    viewerIsPlatformAdmin: false,
    ...overstyr,
  })
}

describe("hva som teller som at kunden åpnet tilbudet", () => {
  it("en anonym besøkende i en vanlig nettleser teller", () => {
    expect(visning()).toBe(true)
  })

  it("avsenderfirmaets egne innloggede brukere teller ikke", () => {
    expect(visning({ viewerCompanyId: "firma-a" })).toBe(false)
  })

  it("en innlogget bruker fra et ANNET firma teller — kunden kan selv være Proanbud-kunde", () => {
    expect(visning({ viewerCompanyId: "firma-b" })).toBe(true)
  })

  it("plattformadmin teller ikke, uansett firma", () => {
    expect(visning({ viewerIsPlatformAdmin: true })).toBe(false)
    expect(visning({ viewerIsPlatformAdmin: true, viewerCompanyId: "firma-b" })).toBe(false)
  })

  it.each([null, undefined, "", "   "])("tom user-agent (%s) teller ikke", (userAgent) => {
    expect(visning({ userAgent })).toBe(false)
  })

  it.each([
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Barracuda Sentinel (EE)",
    "Mimecast-URL-Protect",
  ])("skanneren «%s» teller ikke", (userAgent) => {
    expect(isScannerUserAgent(userAgent)).toBe(true)
    expect(visning({ userAgent })).toBe(false)
  })
})

describe("når «åpnet» nullstilles ved utsending", () => {
  it("første utsending starter alltid på nytt", () => {
    expect(
      shouldResetCustomerView({ previousStatus: "draft", previousRecipientEmail: null, nextRecipientEmail: "ola@hansen.no" })
    ).toBe(true)
  })

  it("trukket tilbake til utkast og sendt igjen er en ny runde, selv til samme adresse", () => {
    expect(
      shouldResetCustomerView({
        previousStatus: "draft",
        previousRecipientEmail: "ola@hansen.no",
        nextRecipientEmail: "ola@hansen.no",
      })
    ).toBe(true)
  })

  it("purring til samme adresse beholder «åpnet»", () => {
    expect(
      shouldResetCustomerView({
        previousStatus: "sent",
        previousRecipientEmail: "ola@hansen.no",
        nextRecipientEmail: "ola@hansen.no",
      })
    ).toBe(false)
  })

  it("samme adresse med andre store bokstaver og mellomrom er fortsatt samme adresse", () => {
    expect(
      shouldResetCustomerView({
        previousStatus: "sent",
        previousRecipientEmail: " Ola@Hansen.no ",
        nextRecipientEmail: "ola@hansen.no",
      })
    ).toBe(false)
  })

  it("ny adresse starter på nytt — det er en annen mottaker", () => {
    expect(
      shouldResetCustomerView({
        previousStatus: "sent",
        previousRecipientEmail: "ola@hansn.no",
        nextRecipientEmail: "ola@hansen.no",
      })
    ).toBe(true)
  })

  it.each(["accepted", "rejected", null, undefined])("fra status %s er det en ny runde", (previousStatus) => {
    expect(
      shouldResetCustomerView({
        previousStatus,
        previousRecipientEmail: "ola@hansen.no",
        nextRecipientEmail: "ola@hansen.no",
      })
    ).toBe(true)
  })
})

describe("hva en Resend-hendelse betyr for tilbudet", () => {
  it("levert er levert", () => {
    expect(classifyOfferEmailEvent("email.delivered")).toBe("delivered")
  })

  it.each(["email.bounced", "email.failed", "email.suppressed"])("%s betyr at kunden ikke fikk e-posten", (type) => {
    expect(classifyOfferEmailEvent(type)).toBe("bounced")
  })

  it.each([
    "email.sent",
    "email.delivery_delayed",
    "email.opened",
    "email.clicked",
    "email.complained",
    "contact.created",
    "",
    null,
    undefined,
  ])("%s angår ikke leveringen", (type) => {
    expect(classifyOfferEmailEvent(type)).toBeNull()
  })
})

describe("nytt forsøk når webhooken slår databasen", () => {
  const now = Date.parse("2026-10-02T07:14:10Z")

  it("ber om nytt forsøk for en e-post som nettopp er sendt", () => {
    expect(shouldRetryUnmatchedOfferEvent({ emailCreatedAt: "2026-10-02T07:14:00Z", now })).toBe(true)
  })

  it("tåler at Resends klokke går litt foran vår", () => {
    expect(shouldRetryUnmatchedOfferEvent({ emailCreatedAt: "2026-10-02T07:14:12Z", now })).toBe(true)
  })

  it("dropper hendelser fra en eldre utsending", () => {
    const gammel = new Date(now - OFFER_EVENT_RETRY_WINDOW_MS).toISOString()
    expect(shouldRetryUnmatchedOfferEvent({ emailCreatedAt: gammel, now })).toBe(false)
    expect(shouldRetryUnmatchedOfferEvent({ emailCreatedAt: "2026-09-28T07:14:00Z", now })).toBe(false)
  })

  it.each([null, undefined, "", "ikke en dato"])("uten gyldig tidspunkt (%s) blir det ikke nytt forsøk", (verdi) => {
    expect(shouldRetryUnmatchedOfferEvent({ emailCreatedAt: verdi, now })).toBe(false)
  })
})
