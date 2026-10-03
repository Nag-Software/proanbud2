import { describe, expect, it } from "vitest"

import {
  buildMetaPixelUrl,
  hasMetaConsent,
  registrationEventId,
} from "@/lib/analytics/meta-pixel"

/**
 * Meta-pixelen er opt-in — motsatt av OpenAI-pixelen i appen. Bare et
 * uttrykkelig «granted» slipper eventet ut.
 */
describe("hasMetaConsent", () => {
  it("måler KUN ved uttrykkelig samtykke", () => {
    expect(hasMetaConsent("granted")).toBe(true)
    expect(hasMetaConsent(" GRANTED ")).toBe(true)
  })

  it("måler ikke når brukeren ikke har tatt stilling, eller har sagt nei", () => {
    expect(hasMetaConsent(null)).toBe(false)
    expect(hasMetaConsent("")).toBe(false)
    expect(hasMetaConsent("denied")).toBe(false)
    expect(hasMetaConsent("noe-annet")).toBe(false)
  })
})

describe("registrationEventId", () => {
  it("er stabil per firma, så en retry dedupliseres hos Meta", () => {
    const id = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"
    expect(registrationEventId(id)).toBe(`reg-${id}`)
    expect(registrationEventId(id)).toBe(registrationEventId(id))
  })
})

describe("buildMetaPixelUrl", () => {
  const base = {
    pixelId: "123",
    event: "CompleteRegistration",
    eventId: "reg-abc",
    pageUrl: "https://app.proanbud.no/create-company",
  }

  it("sender event-ID-en som `eid`, nøkkelen Meta dedupliserer på", () => {
    const url = new URL(buildMetaPixelUrl(base))
    expect(`${url.origin}${url.pathname}`).toBe("https://www.facebook.com/tr")
    expect(url.searchParams.get("id")).toBe("123")
    expect(url.searchParams.get("ev")).toBe("CompleteRegistration")
    expect(url.searchParams.get("eid")).toBe("reg-abc")
    expect(url.searchParams.get("dl")).toBe(base.pageUrl)
  })

  it("tar med fbp/fbc når de finnes, og utelater dem ellers", () => {
    const withCookies = new URL(
      buildMetaPixelUrl({ ...base, fbp: "fb.1.1.2", fbc: "fb.1.1.klikk" })
    )
    expect(withCookies.searchParams.get("fbp")).toBe("fb.1.1.2")
    expect(withCookies.searchParams.get("fbc")).toBe("fb.1.1.klikk")

    const without = new URL(buildMetaPixelUrl({ ...base, fbp: null }))
    expect(without.searchParams.has("fbp")).toBe(false)
    expect(without.searchParams.has("fbc")).toBe(false)
  })
})
