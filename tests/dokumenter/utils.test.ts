import { describe, expect, it } from "vitest"

import { fileKind, isImage, isPdf, isRenderableImage } from "@/components/dokumenter/utils"
import type { DocumentItem } from "@/components/dokumenter/types"

/** Minimal file item; only the fields the classifiers read matter. */
function file(partial: Partial<DocumentItem> & { name: string }): DocumentItem {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    itemType: "file",
    mimeType: partial.mimeType ?? null,
    extension: partial.extension ?? null,
    sizeBytes: partial.sizeBytes ?? 1,
    provider: partial.provider ?? "supabase",
    webUrl: partial.webUrl ?? null,
    downloadUrl: partial.downloadUrl ?? null,
    lastModifiedAt: partial.lastModifiedAt ?? null,
    updatedAt: partial.updatedAt ?? "2026-08-04T00:00:00.000Z",
    folderPath: partial.folderPath ?? null,
  }
}

describe("isRenderableImage — gate for inline preview/thumbnail (open bucket = arbitrary types)", () => {
  it("returns true for formats every mainstream browser paints inline", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico", "apng"]) {
      expect(isRenderableImage(file({ name: `bilde.${ext}`, extension: ext })), ext).toBe(true)
    }
  })

  it("returns true (optimistically) for WebKit-only formats — Safari + appens WebView tegner dem, andre faller tilbake via onError", () => {
    for (const ext of ["heic", "heif", "tif", "tiff"]) {
      expect(isRenderableImage(file({ name: `foto.${ext}`, extension: ext })), ext).toBe(true)
    }
  })

  it("classifies by mimeType when the extension is missing", () => {
    expect(isRenderableImage(file({ name: "uten-ext", mimeType: "image/png" }))).toBe(true)
    expect(isRenderableImage(file({ name: "skann", mimeType: "image/tiff" }))).toBe(true)
    expect(isRenderableImage(file({ name: "ukjent", mimeType: "application/octet-stream" }))).toBe(false)
  })

  it("KJERNEN: en .dwg lastet opp som image/vnd.dwg må IKKE forsøkes inline (ellers ødelagt bilde-ikon)", () => {
    const dwg = file({ name: "tegning.dwg", extension: "dwg", mimeType: "image/vnd.dwg" })
    // fileKind kaller det et «image» (mime startsWith image/), men det er IKKE tegnbart:
    expect(isImage(dwg)).toBe(true)
    expect(isRenderableImage(dwg)).toBe(false)
  })

  it("returns false for non-image files that can arrive now that the bucket is open", () => {
    expect(isRenderableImage(file({ name: "regneark.ods", extension: "ods" }))).toBe(false)
    expect(isRenderableImage(file({ name: "brev.docx", extension: "docx" }))).toBe(false)
    expect(isRenderableImage(file({ name: "arkiv.zip", extension: "zip" }))).toBe(false)
    expect(isRenderableImage(file({ name: "notat.txt", extension: "txt" }))).toBe(false)
    expect(isRenderableImage(file({ name: "modell.ifc", extension: "ifc" }))).toBe(false)
  })

  it("PDF-er går via iframe, ikke <img> — isRenderableImage er false, isPdf er true", () => {
    const pdf = file({ name: "kontrakt.pdf", extension: "pdf", mimeType: "application/pdf" })
    expect(isRenderableImage(pdf)).toBe(false)
    expect(isPdf(pdf)).toBe(true)
  })

  it("returns false for folders", () => {
    const folder: DocumentItem = { ...file({ name: "Mappe" }), itemType: "folder" }
    expect(isRenderableImage(folder)).toBe(false)
  })
})

describe("fileKind — icon classification stays generous (icons never break)", () => {
  it("still gives .ods a sheet icon and .heic an image icon even though the latter may not render inline", () => {
    expect(fileKind(file({ name: "a.ods", extension: "ods" }))).toBe("sheet")
    expect(fileKind(file({ name: "b.heic", extension: "heic" }))).toBe("image")
    expect(fileKind(file({ name: "c.ifc", extension: "ifc" }))).toBe("other")
  })
})
