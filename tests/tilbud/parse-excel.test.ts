import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"

import { parseExcel } from "../../lib/prisfiler/parse-excel"

async function lagArbeidsbok(
  bygg: (ark: ExcelJS.Worksheet) => void,
  arkNavn = "Priser"
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  bygg(wb.addWorksheet(arkNavn))
  const buffer = await wb.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}

describe("parseExcel", () => {
  it("leser en vanlig prisfil", async () => {
    const buffer = await lagArbeidsbok((ark) => {
      ark.addRow(["Varenr", "Beskrivelse", "Pris"])
      ark.addRow(["1001", "Skrue", 12.5])
      ark.addRow(["1002", "Spiker", 8])
    })

    const { parsed, sheetNames } = await parseExcel(buffer)
    expect(sheetNames).toEqual(["Priser"])
    expect(parsed.headers).toEqual(["Varenr", "Beskrivelse", "Pris"])
    expect(parsed.rows).toEqual([
      ["1001", "Skrue", "12.5"],
      ["1002", "Spiker", "8"],
    ])
    expect(parsed.totalDataRows).toBe(2)
  })

  // Regresjon: koden itererte over actualRowCount/actualColumnCount, som er
  // ANTALL rader/kolonner med innhold – ikke arkets ytterpunkter. En tom rad
  // midt i fila og en tom kolonne A gjorde da at siste rad og siste kolonne
  // (prisen!) forsvant stille under import.
  it("mister ikke rader etter en tom rad, eller siste kolonne når kolonne A er tom", async () => {
    const buffer = await lagArbeidsbok((ark) => {
      ark.getCell("B1").value = "Varenr"
      ark.getCell("C1").value = "Beskrivelse"
      ark.getCell("D1").value = "Pris"
      ark.getCell("B2").value = "1001"
      ark.getCell("C2").value = "Skrue"
      ark.getCell("D2").value = 12.5
      ark.getCell("B3").value = "1002"
      ark.getCell("C3").value = "Spiker"
      ark.getCell("D3").value = 8
      // rad 4 bevisst tom
      ark.getCell("B5").value = "1003"
      ark.getCell("C5").value = "Plate"
      ark.getCell("D5").value = 250
      ark.getCell("B6").value = "1004"
      ark.getCell("C6").value = "Lekt"
      ark.getCell("D6").value = 45
    })

    const { parsed } = await parseExcel(buffer)

    expect(parsed.headers).toContain("Pris")
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.rows.at(-1)).toContain("Lekt")
    expect(parsed.rows.map((rad) => rad.at(-1))).toEqual(["12.5", "8", "250", "45"])
  })

  // Prosentceller lagres som andel (0,25) men vises som 25 %. Rabattkolonner
  // må lande som 25, ikke 0.25.
  it("regner prosentceller om til hele prosent", async () => {
    const buffer = await lagArbeidsbok((ark) => {
      ark.addRow(["Varenr", "Rabatt"])
      const rad = ark.addRow(["1001", 0.25])
      rad.getCell(2).numFmt = "0%"
    })

    const { parsed } = await parseExcel(buffer)
    expect(parsed.rows[0][1]).toBe("25")
  })

  it("leser formelceller som den utregnede verdien", async () => {
    const buffer = await lagArbeidsbok((ark) => {
      ark.addRow(["Varenr", "Pris"])
      ark.addRow(["1001", { formula: "10*2", result: 20 }])
    })

    const { parsed } = await parseExcel(buffer)
    expect(parsed.rows[0][1]).toBe("20")
  })

  it("gjør like kolonnenavn unike", async () => {
    const buffer = await lagArbeidsbok((ark) => {
      ark.addRow(["Pris", "Pris"])
      ark.addRow(["10", "20"])
    })

    const { parsed } = await parseExcel(buffer)
    expect(parsed.headers).toEqual(["Pris", "Pris_2"])
  })

  it("takler et tomt ark uten å kaste", async () => {
    const buffer = await lagArbeidsbok(() => {})
    const { parsed } = await parseExcel(buffer)
    expect(parsed.headers).toEqual([])
    expect(parsed.rows).toEqual([])
  })
})
