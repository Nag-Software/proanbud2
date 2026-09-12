import { describe, expect, it } from "vitest"

import {
  DEFAULT_WINDOW,
  isSendableDay,
  isWithinSendWindow,
  nextSendSlot,
  norwegianHolidays,
  osloParts,
} from "@/lib/outreach/sendetid"

describe("norwegianHolidays", () => {
  it("finner de bevegelige dagene i 2026 (påskedag 5. april)", () => {
    const holidays = norwegianHolidays(2026)
    expect(holidays.has("04-02")).toBe(true) // skjærtorsdag
    expect(holidays.has("04-03")).toBe(true) // langfredag
    expect(holidays.has("04-06")).toBe(true) // andre påskedag
    expect(holidays.has("05-14")).toBe(true) // Kristi himmelfart
    expect(holidays.has("05-25")).toBe(true) // andre pinsedag
  })

  it("finner de faste dagene", () => {
    const holidays = norwegianHolidays(2026)
    expect(holidays.has("01-01")).toBe(true)
    expect(holidays.has("05-01")).toBe(true)
    expect(holidays.has("05-17")).toBe(true)
    expect(holidays.has("12-25")).toBe(true)
  })

  it("regner riktig for et annet år (påskedag 28. mars 2027)", () => {
    expect(norwegianHolidays(2027).has("03-26")).toBe(true) // langfredag
  })
})

describe("isSendableDay", () => {
  it("sender på en vanlig onsdag", () => {
    expect(isSendableDay(new Date("2026-09-16T09:00:00Z"))).toBe(true)
  })

  it("sender ikke i helgen", () => {
    expect(isSendableDay(new Date("2026-09-19T09:00:00Z"))).toBe(false) // lørdag
    expect(isSendableDay(new Date("2026-09-20T09:00:00Z"))).toBe(false) // søndag
  })

  it("sender ikke 17. mai", () => {
    expect(isSendableDay(new Date("2027-05-17T09:00:00Z"))).toBe(false) // mandag
  })

  it("sender ikke i fellesferien", () => {
    expect(isSendableDay(new Date("2026-07-15T09:00:00Z"))).toBe(false)
    // 1. juli er utenfor uke 28–30 og går fint.
    expect(isSendableDay(new Date("2026-07-01T09:00:00Z"))).toBe(true)
  })

  it("sender ikke i romjulen", () => {
    expect(isSendableDay(new Date("2026-12-28T09:00:00Z"))).toBe(false) // mandag
  })
})

describe("nextSendSlot", () => {
  // Fast «tilfeldighet» gjør testen forutsigbar: midt i vinduet.
  const mid = () => 0.5

  it("legger sendingen inn i vinduet samme dag når det er tidlig nok", () => {
    // Onsdag 16. sept. 2026 kl. 06:00 Oslo (04:00 UTC, sommertid).
    const slot = nextSendSlot(new Date("2026-09-16T04:00:00Z"), DEFAULT_WINDOW, mid)
    const parts = osloParts(slot)
    expect(parts.day).toBe(16)
    expect(parts.hour * 60 + parts.minute).toBeGreaterThanOrEqual(7 * 60 + 30)
    expect(parts.hour * 60 + parts.minute).toBeLessThan(15 * 60 + 30)
  })

  it("flytter til neste dag når vinduet er passert", () => {
    // Onsdag kl. 19:00 Oslo — for sent.
    const slot = nextSendSlot(new Date("2026-09-16T17:00:00Z"), DEFAULT_WINDOW, mid)
    expect(osloParts(slot).day).toBe(17)
  })

  it("hopper over helgen", () => {
    // Fredag 18. sept. kl. 19:00 Oslo → mandag 21.
    const slot = nextSendSlot(new Date("2026-09-18T17:00:00Z"), DEFAULT_WINDOW, mid)
    const parts = osloParts(slot)
    expect(parts.day).toBe(21)
    expect(parts.weekday).toBe(1)
  })

  it("hopper over en helligdag", () => {
    // Torsdag 30. april 2026 kl. 19:00 → 1. mai er rød, så fredag faller bort.
    const slot = nextSendSlot(new Date("2026-04-30T17:00:00Z"), DEFAULT_WINDOW, mid)
    const parts = osloParts(slot)
    expect(parts.month).toBe(5)
    expect(parts.day).toBe(4) // mandag
  })

  it("sprer sendingene — ulik tilfeldighet gir ulikt tidspunkt", () => {
    const from = new Date("2026-09-16T04:00:00Z")
    const tidlig = nextSendSlot(from, DEFAULT_WINDOW, () => 0.01)
    const sent = nextSendSlot(from, DEFAULT_WINDOW, () => 0.99)
    expect(sent.getTime()).toBeGreaterThan(tidlig.getTime())
  })

  it("gir alltid et tidspunkt inne i vinduet", () => {
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      const slot = nextSendSlot(new Date("2026-09-16T04:00:00Z"), DEFAULT_WINDOW, () => random)
      expect(isWithinSendWindow(slot)).toBe(true)
    }
  })
})

describe("isWithinSendWindow", () => {
  it("er sant midt i arbeidsdagen", () => {
    // Onsdag 10:00 Oslo = 08:00 UTC (sommertid).
    expect(isWithinSendWindow(new Date("2026-09-16T08:00:00Z"))).toBe(true)
  })

  it("er usant før vinduet åpner og etter at det lukker", () => {
    expect(isWithinSendWindow(new Date("2026-09-16T04:00:00Z"))).toBe(false) // 06:00
    expect(isWithinSendWindow(new Date("2026-09-16T16:00:00Z"))).toBe(false) // 18:00
  })
})
