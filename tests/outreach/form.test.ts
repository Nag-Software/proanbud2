import { describe, expect, it } from "vitest"

import { finishBody, SIGNATURE, withoutSignature } from "@/lib/outreach/write/form"

// Slik utkastene faktisk kom fra modellen i testkjøringen 2026-09-27: enkle
// linjeskift og ingen signatur.
const FRA_MODELLEN = `Hei,
Jeg så at dere tar tilbygg og garasjer i hele Vestfold.
Proanbud bygger tilbudet fra deres egne priser.
Hvordan setter dere opp tilbudene i dag?`

const FERDIG = `Hei,

Jeg så at dere tar tilbygg og garasjer i hele Vestfold.

Proanbud bygger tilbudet fra deres egne priser.

Hvordan setter dere opp tilbudene i dag?

${SIGNATURE}`

describe("finishBody", () => {
  it("legger på signaturen og gjør hver linje til et avsnitt", () => {
    expect(finishBody(FRA_MODELLEN)).toBe(FERDIG)
  })

  it("bytter ut signaturen og hilsenen modellen skrev selv — alltid nøyaktig én", () => {
    expect(finishBody(`${FRA_MODELLEN}\n\nMvh\nCasper Nag\nProanbud — et produkt fra Nag Software, Holmestrand`)).toBe(FERDIG)
    expect(finishBody(`${FRA_MODELLEN}\n\nHilsen Casper`)).toBe(FERDIG)
    expect(finishBody(`${FRA_MODELLEN}\r\n\r\nCasper Nag\r\nProanbud - Nag Software`)).toBe(FERDIG)
    expect(finishBody(`${FRA_MODELLEN}\n\nMvh Casper\nProanbud.no`)).toBe(FERDIG)
    expect(finishBody(`${FRA_MODELLEN}\n\nMvh Casper\nwww.proanbud.no`)).toBe(FERDIG)
    expect(finishBody(FERDIG).match(/Mvh Casper/g)).toHaveLength(1)
  })

  it("signerer «Mvh Casper / Proanbud.no» — aldri «et produkt fra Nag Software»", () => {
    expect(FERDIG.endsWith("\n\nMvh Casper\nProanbud.no")).toBe(true)
    expect(finishBody(FRA_MODELLEN)).not.toMatch(/nag software/i)
  })

  it("setter «Hei,» på egen linje", () => {
    const body = finishBody("Hei, jeg så at dere tar tilbygg og garasjer i hele Vestfold.\nHvordan gjør dere det i dag?")
    expect(body.startsWith("Hei,\n\nJeg så at dere tar tilbygg")).toBe(true)
  })

  it("endrer ikke en ferdig tekst", () => {
    expect(finishBody(FERDIG)).toBe(FERDIG)
  })
})

describe("withoutSignature", () => {
  it("tar bort signaturen og hilsenen, men aldri spørsmålet", () => {
    expect(withoutSignature(FERDIG)).toBe(FERDIG.replace(`\n\n${SIGNATURE}`, ""))
    expect(withoutSignature("Hei,\n\nHvordan gjør dere det, Casper?\n\nMvh\nCasper Nag")).toBe(
      "Hei,\n\nHvordan gjør dere det, Casper?",
    )
  })

  it("beholder det som står etter signaturen — det sendes, så det skal sjekkes", () => {
    const withPs = `${FERDIG}\n\nPS: Kundene sparer 50 % admin-tid.`
    expect(withoutSignature(withPs)).toContain("PS: Kundene sparer 50 % admin-tid.")
  })
})
