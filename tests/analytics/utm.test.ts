import { describe, expect, it } from "vitest"

import {
  firstTouchToCompanyColumns,
  hasAttributionParams,
  parseFirstTouch,
  parseFirstTouchCookie,
  referrerHost,
  serializeFirstTouch,
} from "@/lib/analytics/utm"

describe("utm første berøring", () => {
  const now = new Date("2026-10-09T10:00:00Z")

  it("ignorerer URL-er uten utm/klikk-ID", () => {
    expect(hasAttributionParams(new URLSearchParams("invite=abc"))).toBe(false)
    expect(
      parseFirstTouch({ searchParams: new URLSearchParams("foo=bar"), pathname: "/signup", now })
    ).toBeNull()
  })

  it("plukker utm, klikk-ID og ekstern referrer", () => {
    const touch = parseFirstTouch({
      searchParams: new URLSearchParams(
        "utm_source=facebook&utm_medium=cpc&utm_campaign=host&fbclid=XYZ"
      ),
      pathname: "/kalkulator",
      referrer: "https://l.facebook.com/l.php?u=…",
      now,
    })
    expect(touch).toMatchObject({
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "host",
      click_network: "meta",
      click_id: "XYZ",
      landing_path: "/kalkulator",
      referrer_host: "l.facebook.com",
      first_touch_at: now.toISOString(),
    })
  })

  it("dropper intern referrer (proanbud.no → app.proanbud.no)", () => {
    const touch = parseFirstTouch({
      searchParams: new URLSearchParams("utm_source=landing"),
      pathname: "/signup",
      referrer: "https://proanbud.no/priser",
      now,
    })
    expect(touch?.referrer_host).toBeNull()
    expect(referrerHost("ikke en url")).toBeNull()
  })

  it("overlever runden cookie → kolonner", () => {
    const touch = parseFirstTouch({
      searchParams: new URLSearchParams("utm_source=google&gclid=abc123&utm_term=tilbud%20app"),
      pathname: "/",
      now,
    })!
    const cookie = serializeFirstTouch(touch)
    expect(cookie.length).toBeLessThan(400)
    expect(cookie.startsWith("{")).toBe(true)
    // Dekodet (Next cookies().get) og rå URL-enkodet (document.cookie) leses likt.
    expect(parseFirstTouchCookie(cookie)).toEqual(touch)
    const back = parseFirstTouchCookie(encodeURIComponent(cookie))
    expect(back).toEqual(touch)
    expect(firstTouchToCompanyColumns(back!)).toMatchObject({
      utm_source: "google",
      utm_term: "tilbud app",
      acquisition_click_network: "google",
      acquisition_click_id: "abc123",
      acquisition_first_touch_at: now.toISOString(),
    })
  })

  it("tåler ødelagt cookie", () => {
    expect(parseFirstTouchCookie("%7Bnot-json")).toBeNull()
    expect(parseFirstTouchCookie("")).toBeNull()
    expect(parseFirstTouchCookie(encodeURIComponent(JSON.stringify({ at: "x" })))).toBeNull()
  })
})
