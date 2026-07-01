"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import { buildOfferDocumentPage, type OfferDocumentData } from "@/lib/tilbud/offer-document"
import { cn } from "@/lib/utils"

// A4 at 96 DPI. The document is always rendered at this fixed width and then
// scaled down to fit narrow viewports, so it looks identical on mobile and
// desktop — like a real sheet of paper in a PDF viewer.
const A4_WIDTH = 794
const A4_HEIGHT = 1123

type OfferDocumentViewerProps = OfferDocumentData & {
  showSupplier?: boolean
  className?: string
  /**
   * Server PDF endpoint for this offer. When provided, the download button
   * opens the properly typeset server-generated PDF (same renderer as the
   * customer download). Without it (e.g. unsaved drafts in the wizard) the
   * browser print dialog is used as fallback.
   */
  pdfUrl?: string
  /** Called when the user triggers a PDF download (e.g. to log the export). */
  onDownload?: () => void
}

export function OfferDocumentViewer({
  showSupplier = true,
  className,
  pdfUrl,
  onDownload,
  ...data
}: OfferDocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [sheetHeight, setSheetHeight] = useState(A4_HEIGHT)

  useEffect(() => {
    const container = containerRef.current
    const sheet = sheetRef.current
    if (!container || !sheet) return

    const update = () => {
      const available = container.clientWidth
      setScale(available > 0 ? Math.min(1, available / A4_WIDTH) : 1)
      setSheetHeight(Math.max(sheet.offsetHeight, A4_HEIGHT))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [data, showSupplier])

  const pageHtml = useMemo(
    () => buildOfferDocumentPage({ ...data }, { showSupplier }),
    [data, showSupplier]
  )

  const openInNewTab = useCallback(() => {
    const blob = new Blob([pageHtml], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank", "noopener,noreferrer")
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [pageHtml])

  const downloadPdf = useCallback(() => {
    onDownload?.()

    if (pdfUrl) {
      window.open(pdfUrl, "_blank")
      return
    }

    const printHtml = buildOfferDocumentPage({ ...data }, { showSupplier, autoPrint: true })
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      // Pop-up blocked — fall back to opening the document so the user can
      // still print/save from the browser.
      openInNewTab()
      return
    }
    printWindow.document.write(printHtml)
    printWindow.document.close()
  }, [data, showSupplier, pdfUrl, onDownload, openInNewTab])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={openInNewTab}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Åpne i ny fane
        </Button>
        <Button type="button" size="sm" className="h-9" onClick={downloadPdf}>
          <Download className="mr-2 h-4 w-4" />
          Last ned PDF
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg bg-[#e8e6e1] p-3 sm:p-5">
        <div ref={containerRef} className="mx-auto" style={{ maxWidth: A4_WIDTH }}>
          {/* Reserve the scaled height so surrounding layout stays correct. */}
          <div style={{ height: sheetHeight * scale }}>
            <div
              ref={sheetRef}
              style={{
                width: A4_WIDTH,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <OfferDocumentPreview
                {...data}
                showSupplier={showSupplier}
                className="bg-transparent p-0"
                documentClassName="w-[794px] min-h-[1123px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.18)]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
