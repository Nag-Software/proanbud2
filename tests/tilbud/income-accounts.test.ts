import { describe, expect, it } from "vitest"

import {
  effectiveIncomeAccountCategory,
  inferIncomeAccountCategory,
  resolveIncomeAccountCode,
} from "../../lib/tilbud/income-accounts"

// Kontokodene er hentet fra Fikens faktiske kontoplan (/accounts, område 3000–3999):
//   3000 Salgsinntekt varer, høy mva-sats        3200 ... unntatt for mva
//   3010 egenproduserte varer, høy mva-sats      3210 ... unntatt for mva
//   3020 tjenester, høy mva-sats                 3220 ... unntatt for mva
//   3900 Annen driftsrelatert inntekt (én variant)
describe("resolveIncomeAccountCode", () => {
  it("bruker høy-sats-kontoene for mva-registrerte bedrifter", () => {
    expect(resolveIncomeAccountCode("vare_videresalg", true)).toBe("3000")
    expect(resolveIncomeAccountCode("vare_egenprodusert", true)).toBe("3010")
    expect(resolveIncomeAccountCode("tjeneste", true)).toBe("3020")
    expect(resolveIncomeAccountCode("annet", true)).toBe("3900")
  })

  it("bruker «unntatt for mva»-kontoene når bedriften ikke er registrert", () => {
    expect(resolveIncomeAccountCode("vare_videresalg", false)).toBe("3200")
    expect(resolveIncomeAccountCode("vare_egenprodusert", false)).toBe("3210")
    expect(resolveIncomeAccountCode("tjeneste", false)).toBe("3220")
    // Annen driftsinntekt har ingen mva-variant.
    expect(resolveIncomeAccountCode("annet", false)).toBe("3900")
  })

  it("faller tilbake til tjeneste når kategorien mangler", () => {
    expect(resolveIncomeAccountCode(undefined, true)).toBe("3020")
    expect(resolveIncomeAccountCode(undefined, false)).toBe("3220")
  })
})

describe("inferIncomeAccountCategory", () => {
  it("tolker tidsenheter som tjeneste", () => {
    for (const unit of ["time", "timer", "t", "dag", "TIMER"]) {
      expect(inferIncomeAccountCategory({ unit })).toBe("tjeneste")
    }
  })

  it("tolker linjer med leverandøridentitet som vare for videresalg", () => {
    expect(inferIncomeAccountCategory({ unit: "stk", supplier: "Ahlsell" })).toBe("vare_videresalg")
    expect(inferIncomeAccountCategory({ unit: "stk", supplierSku: "12345" })).toBe("vare_videresalg")
    expect(inferIncomeAccountCategory({ unit: "m2", nobb: "998877" })).toBe("vare_videresalg")
  })

  it("faller tilbake til tjeneste for linjer uten holdepunkter", () => {
    expect(inferIncomeAccountCategory({ unit: "stk" })).toBe("tjeneste")
    expect(inferIncomeAccountCategory({})).toBe("tjeneste")
  })

  it("gjetter ALDRI egenprodusert — det skillet må bedriften ta selv", () => {
    const guesses = [
      inferIncomeAccountCategory({ unit: "stk", supplier: "Ahlsell" }),
      inferIncomeAccountCategory({ unit: "time" }),
      inferIncomeAccountCategory({}),
    ]
    expect(guesses).not.toContain("vare_egenprodusert")
  })
})

describe("effectiveIncomeAccountCategory", () => {
  it("lar et eksplisitt valg overstyre gjetningen", () => {
    // Ville blitt gjettet som vare_videresalg pga. leverandør.
    const item = { unit: "stk", supplier: "Ahlsell", incomeAccountCategory: "vare_egenprodusert" as const }
    expect(effectiveIncomeAccountCategory(item)).toBe("vare_egenprodusert")
  })

  it("ignorerer ugyldige verdier og gjetter i stedet", () => {
    const item = { unit: "time", incomeAccountCategory: "tull" as never }
    expect(effectiveIncomeAccountCategory(item)).toBe("tjeneste")
  })
})
