// Parsing av prisfiler i Excel-format, skilt ut fra prisfiler-page.tsx slik
// at den kan testes direkte. Resten av veiviseren (auto-detect, mapping,
// applyMapping) gjenbrukes uendret på formen som returneres her.

export type ParsedData = {
  headers: string[]
  rows: string[][]
  // Antall datarader i fila før MAX_ROWS-kuttet – brukes til å varsle brukeren
  // om at ikke alt ble med, i stedet for å kutte stille.
  totalDataRows?: number
}

// Deduplicate headers so keys are always unique (e.g. "" → "_1", "_2"; "Pris" x2 → "Pris", "Pris_2")
export function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((h) => {
    const base = h || "_"
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}

export const MAX_ROWS = 100000

// ── Excel (.xlsx / .xlsm) ────────────────────────────────────────────────────
// Parses the FIRST sheet into the same ParsedData shape as parseCSV, so the
// rest of the wizard (auto-detect, mapping, applyMapping) is reused unchanged.
// exceljs is imported dynamically so CSV users never download the library.


export async function parseExcel(buffer: ArrayBuffer): Promise<{ parsed: ParsedData; sheetNames: string[] }> {
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  await workbook.xlsx.load(buffer)
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { parsed: { headers: [], rows: [] }, sheetNames }

  // numFmt er undefined for celler uten eksplisitt tallformat – altså de
  // fleste tallceller i en vanlig prisfil. Uten fallback kastet .includes()
  // her, og hele importen feilet med «Kunne ikke lese Excel-filen».
  const toText = (value: unknown, numFmt: string = ""): string => {
    if (value == null) return ""
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value === "number") {
      const normalized = numFmt.includes("%") ? Math.round(value * 100 * 1e8) / 1e8 : value
      return String(normalized)
    }
    if (typeof value === "string" || typeof value === "boolean") return String(value).trim()
    if (typeof value === "object") {
      if ("result" in value) return toText(value.result, numFmt)
      if ("text" in value && typeof value.text === "string") return value.text.trim()
      if ("richText" in value && Array.isArray(value.richText)) {
        return value.richText
          .map((part) =>
            part && typeof part === "object" && "text" in part && typeof part.text === "string"
              ? part.text
              : ""
          )
          .join("")
          .trim()
      }
    }
    return ""
  }

  const rows: string[][] = []
  // rowCount/columnCount er arkets ytterpunkter. actualRowCount/
  // actualColumnCount teller derimot hvor MANGE rader og kolonner som har
  // innhold, så en tom rad midt i fila eller en tom kolonne A gjorde at de
  // siste radene og den siste kolonnen (typisk prisen) forsvant uten feil.
  const columnCount = sheet.columnCount
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row: string[] = []
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber++) {
      const cell = sheet.getCell(rowNumber, columnNumber)
      row.push(toText(cell.value, cell.numFmt ?? ""))
    }
    if (row.some((cell) => cell !== "")) rows.push(row)
  }

  if (rows.length === 0) return { parsed: { headers: [], rows: [] }, sheetNames }

  return {
    parsed: {
      headers: dedupeHeaders(rows[0]),
      rows: rows.slice(1, MAX_ROWS + 1),
      totalDataRows: rows.length - 1,
    },
    sheetNames,
  }
}

