import { describe, expect, it } from "vitest"

import { checkQuoteGrounding, isQuoteGrounded, numbersIn } from "@/lib/outreach/research/ground"

// Sideteksten er fasiten. Alt en modell påstår må finnes her, ordrett.
const SIDE = `
Vi er et tømrerfirma i Holmestrand med 12 ansatte.
Vi tar på oss alt fra tilbygg og garasjer til komplette rehabiliteringer av bad.
Se våre referanseprosjekter fra Vestfold og Telemark.
Be om et uforpliktende tilbud — vi kommer gjerne på befaring.
`

describe("checkQuoteGrounding", () => {
  it("godtar et ordrett sitat", () => {
    const result = checkQuoteGrounding("alt fra tilbygg og garasjer", SIDE)
    expect(result.grounded).toBe(true)
    expect(result.reason).toBe("ok")
  })

  it("tåler forskjeller i whitespace, store bokstaver og tegnsetting", () => {
    expect(isQuoteGrounded("Alt fra tilbygg   og garasjer,", SIDE)).toBe(true)
  })

  it("tåler typografiske anførselstegn og bindestreker", () => {
    expect(isQuoteGrounded("uforpliktende tilbud – vi kommer gjerne", SIDE)).toBe(true)
  })

  it("avviser et omskrevet sitat selv om alle ordene finnes", () => {
    // Alle ordene står på siden, men setningen gjør det ikke. Dette er akkurat
    // feilen ordoverlapp slipper gjennom, og som vi ikke vil ha.
    const result = checkQuoteGrounding("garasjer og tilbygg fra alt", SIDE)
    expect(result.grounded).toBe(false)
    expect(result.reason).toBe("ikke_funnet")
  })

  it("avviser et rent hallusinert sitat", () => {
    expect(isQuoteGrounded("vi har 30 års erfaring med hyttebygging", SIDE)).toBe(false)
  })

  it("avviser sitater som er for korte til å bety noe", () => {
    // «bad» finnes, men tre ord der to er stoppord er ikke personalisering.
    const result = checkQuoteGrounding("av bad", SIDE)
    expect(result.grounded).toBe(false)
    expect(result.reason).toBe("for_kort")
  })

  it("avviser tomt sitat", () => {
    expect(checkQuoteGrounding("   ", SIDE).reason).toBe("tom")
  })
})

describe("numbersIn", () => {
  it("finner tall uansett formatering", () => {
    expect(numbersIn("29 kr/mnd, 1 190 kr og 14 dager")).toEqual(["29", "1190", "14"])
  })

  it("gir tom liste når teksten ikke har tall", () => {
    expect(numbersIn("Hei, hvordan lager dere tilbud i dag?")).toEqual([])
  })
})
