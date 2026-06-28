"use client"

import { useEffect, useState } from "react"
import { Download, ExternalLink, Loader2, PencilLine, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { resolveFileUrl } from "../data/api"
import { formatBytes, formatDateTime, isImage, isPdf, providerLabel } from "../utils"
import { FileGlyph } from "./file-glyph"
import type { DocumentItem } from "../types"

type Props = {
  item: DocumentItem
  onClose: () => void
  canMutate: boolean
  onRename: (item: DocumentItem) => void
  onDelete: (item: DocumentItem) => void
  onDownload: (item: DocumentItem) => void
}

export function PreviewPanel({ item, onClose, canMutate, onRename, onDelete, onDownload }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const showInline = item.itemType === "file" && (isImage(item) || isPdf(item))

  /* eslint-disable react-hooks/set-state-in-effect -- lazily resolving a signed URL for the selected file */
  useEffect(() => {
    if (!showInline) {
      setUrl(null)
      return
    }
    let active = true
    setLoading(true)
    setUrl(null)
    resolveFileUrl(item)
      .then((u) => {
        if (active) setUrl(u)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [item, showInline])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <aside
      className="theme-docs-divider hidden w-[320px] shrink-0 flex-col border-l lg:flex"
      style={{ background: "var(--surface-soft)" }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-semibold">Detaljer</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Lukk detaljer" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {showInline ? (
            loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : url && isImage(item) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={item.name} className="h-full w-full object-contain" />
            ) : url && isPdf(item) ? (
              <iframe src={url} title={item.name} className="h-full w-full" />
            ) : (
              <FileGlyph item={item} className="h-12 w-12" />
            )
          ) : (
            <FileGlyph item={item} className="h-12 w-12" />
          )}
        </div>

        <p className="flex items-center gap-2 break-words text-sm font-medium">
          <FileGlyph item={item} className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{item.name}</span>
        </p>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Type</dt>
          <dd>{item.itemType === "folder" ? "Mappe" : item.extension?.toUpperCase() || "Fil"}</dd>
          <dt className="text-muted-foreground">Leverandør</dt>
          <dd>{providerLabel(item.provider)}</dd>
          {item.itemType === "file" && (
            <>
              <dt className="text-muted-foreground">Størrelse</dt>
              <dd>{formatBytes(item.sizeBytes)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Endret</dt>
          <dd>{formatDateTime(item.lastModifiedAt)}</dd>
        </dl>
      </div>

      {item.itemType === "file" && (
        <div className="grid grid-cols-2 gap-2 border-t p-3">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onDownload(item)}>
            <Download className="h-4 w-4" />
            Last ned
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!url}
            onClick={() => url && window.open(url, "_blank", "noreferrer")}
          >
            <ExternalLink className="h-4 w-4" />
            Åpne
          </Button>
          {canMutate && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onRename(item)}>
                <PencilLine className="h-4 w-4" />
                Gi navn
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => onDelete(item)}
              >
                <Trash2 className="h-4 w-4" />
                Slett
              </Button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
