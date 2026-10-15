/**
 * Laster en tegning (DXF, PDF, PNG/JPG) for visning under plantegningen.
 *
 * Tegningens egne enheter: DXF-enheter, PDF-punkter (1/72 tomme) eller
 * bildepiksler. `ModelImport.scale` er meter per slik enhet, så målestokken
 * ikke avhenger av hvor skarpt PDF-en rendres.
 *
 * Bare for nettleseren.
 */

import type { ImportFormat } from "../types"
import { lesDxf, type DxfTegning } from "./dxf"
import { gjettSkala } from "./formats"

export type LastetTegning =
  | ({ type: "linjer" } & DxfTegning)
  | {
      type: "bilde"
      url: string
      /** I tegningens enheter (PDF-punkter eller piksler). */
      bredde: number
      hoyde: number
      /** PDF: antall sider. */
      sider: number
    }

/** Største side i den renderte PDF-en. Skarpt nok til å lese mål, ikke tyngre. */
const PDF_MAKS_PIKSLER = 4096

/** 1 PDF-punkt ved målestokk 1:100, i meter. */
export const PDF_PUNKT_1_100 = (0.0254 / 72) * 100

export async function lastTegning(format: ImportFormat, data: ArrayBuffer, side = 1): Promise<LastetTegning> {
  if (format === "dxf") {
    const tegning = lesDxf(new TextDecoder().decode(data))
    if (tegning.antallSegmenter === 0) throw new Error("Fant ingen linjer i DXF-fila.")
    return { type: "linjer", ...tegning }
  }
  if (format === "pdf") return lastPdf(data, side)
  if (format === "png" || format === "jpg") {
    const url = URL.createObjectURL(new Blob([data], { type: format === "png" ? "image/png" : "image/jpeg" }))
    const { bredde, hoyde } = await bildeStorrelse(url)
    return { type: "bilde", url, bredde, hoyde, sider: 1 }
  }
  throw new Error("Dette er en 3D-modell, ikke en tegning.")
}

async function lastPdf(data: ArrayBuffer, side: number): Promise<LastetTegning> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf")
  const dokument = await getDocumentProxy(new Uint8Array(data))
  const sideNr = Math.min(Math.max(1, side), dokument.numPages)
  const pdfSide = await dokument.getPage(sideNr)
  const visning = pdfSide.getViewport({ scale: 1 })
  const skala = Math.min(4, PDF_MAKS_PIKSLER / Math.max(visning.width, visning.height))
  const url = await renderPageAsImage(dokument, sideNr, { scale: skala, toDataURL: true })
  return { type: "bilde", url, bredde: visning.width, hoyde: visning.height, sider: dokument.numPages }
}

function bildeStorrelse(url: string): Promise<{ bredde: number; hoyde: number }> {
  return new Promise((resolve, reject) => {
    const bilde = new Image()
    bilde.onload = () => resolve({ bredde: bilde.naturalWidth, hoyde: bilde.naturalHeight })
    bilde.onerror = () => reject(new Error("Bildet kunne ikke leses."))
    bilde.src = url
  })
}

/** Meter per tegningsenhet når en tegning legges inn første gang. */
export function startSkala(format: ImportFormat, tegning: LastetTegning): number {
  if (tegning.type === "linjer") {
    if (tegning.enhetSkala) return tegning.enhetSkala
    const g = tegning.grenser
    return g ? gjettSkala(Math.max(g.maxX - g.minX, g.maxY - g.minY)) : 1
  }
  if (format === "pdf") return PDF_PUNKT_1_100
  // Et bilde har ingen målestokk: legg det inn omtrent 20 m bredt og la
  // brukeren kalibrere.
  return 20 / Math.max(tegning.bredde, 1)
}
