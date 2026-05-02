"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type DocumentItem = {
  id: string
  name: string
  itemType: "file" | "folder"
  mimeType: string | null
  extension: string | null
  sizeBytes: number | null
  provider: "supabase" | "google_drive" | "onedrive"
  webUrl: string | null
  downloadUrl: string | null
  updatedAt: string
}

function formatSize(size?: number | null) {
  if (!size || size <= 0) return "-"
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let index = 0

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("no-NO")
}

type Props = {
  projectId: string
}

export default function ProjectDocumentsTab({ projectId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderPath = `prosjekter/${projectId}`

  const [items, setItems] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const [previewTarget, setPreviewTarget] = useState<DocumentItem | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewText, setPreviewText] = useState<string | null>(null)

  const files = useMemo(() => items.filter((item) => item.itemType === "file"), [items])

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files
    return files.filter((file) => file.name.toLowerCase().includes(q))
  }, [files, query])

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ provider: "supabase", parentId: folderPath })
      const res = await fetch(`/api/documents?${params.toString()}`)

      if (!res.ok) {
        setItems([])
        toast.error("Kunne ikke hente prosjektdokumenter.")
        return
      }

      const data = await res.json()
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [folderPath])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  async function onAddFiles(filesToUpload: FileList | null) {
    if (!filesToUpload || filesToUpload.length === 0) return

    setBusyId("__upload__")
    try {
      let hasError = false

      for (const file of Array.from(filesToUpload)) {
        const payload = new FormData()
        payload.set("provider", "supabase")
        payload.set("parentId", folderPath)
        payload.set("file", file)

        const res = await fetch("/api/documents", {
          method: "POST",
          body: payload,
        })

        if (!res.ok) {
          hasError = true
          const data = await res.json()
          toast.error(data.error ?? `Kunne ikke laste opp ${file.name}`)
        }
      }

      if (!hasError) {
        toast.success("Dokument(er) lagt til prosjektet.")
      }

      await loadFiles()
    } finally {
      setBusyId(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function askRename(item: DocumentItem) {
    setRenameTarget(item)
    setRenameValue(item.name)
  }

  async function onRename() {
    if (!renameTarget) return

    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === renameTarget.name) {
      setRenameTarget(null)
      return
    }

    setBusyId(renameTarget.id)
    try {
      const res = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          provider: renameTarget.provider,
          id: renameTarget.id,
          newName: trimmed,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke endre navn.")
        return
      }

      setRenameTarget(null)
      await loadFiles()
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(item: DocumentItem) {
    setBusyId(item.id)
    try {
      const params = new URLSearchParams({ provider: item.provider, id: item.id })
      const res = await fetch(`/api/documents?${params.toString()}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Kunne ikke slette dokumentet.")
        return
      }

      toast.success("Dokument slettet.")
      await loadFiles()
    } finally {
      setBusyId(null)
    }
  }

  async function onOpenPreview(item: DocumentItem) {
    setPreviewTarget(item)
    setPreviewText(null)

    if (!item.downloadUrl) return

    const canLoadAsText =
      item.mimeType?.startsWith("text/") ||
      ["txt", "md", "json", "csv", "xml", "html"].includes((item.extension ?? "").toLowerCase())

    if (!canLoadAsText) return

    setPreviewLoading(true)
    try {
      const res = await fetch(item.downloadUrl)
      if (!res.ok) {
        setPreviewText("Kunne ikke laste innholdet.")
        return
      }

      setPreviewText(await res.text())
    } catch {
      setPreviewText("Kunne ikke laste innholdet.")
    } finally {
      setPreviewLoading(false)
    }
  }

  const previewUrl = previewTarget?.webUrl ?? previewTarget?.downloadUrl ?? null
  const isImage = Boolean(previewTarget?.mimeType?.startsWith("image/"))
  const isPdf =
    previewTarget?.mimeType === "application/pdf" ||
    (previewTarget?.extension ?? "").toLowerCase() === "pdf"
  const isVideo = Boolean(previewTarget?.mimeType?.startsWith("video/"))
  const isAudio = Boolean(previewTarget?.mimeType?.startsWith("audio/"))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sok i prosjektfiler"
            className="pl-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onAddFiles(e.target.files)}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={busyId === "__upload__"}>
            <Plus className="h-4 w-4" />
            Legg til dokument
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Storrelse</TableHead>
              <TableHead>Sist oppdatert</TableHead>
              <TableHead className="w-[140px] text-right">Handlinger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Laster dokumenter...
                </TableCell>
              </TableRow>
            ) : filteredFiles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Ingen dokumenter i dette prosjektet ennå.
                </TableCell>
              </TableRow>
            ) : (
              filteredFiles.map((item) => {
                const disabled = busyId === item.id

                return (
                  <TableRow key={item.id}>
                    <TableCell onClick={() => void onOpenPreview(item)} className="font-medium">
                      {item.name}
                    </TableCell>
                    <TableCell onClick={() => void onOpenPreview(item)}>
                      {item.extension?.toUpperCase() ?? "Fil"}
                    </TableCell>
                    <TableCell onClick={() => void onOpenPreview(item)}>{formatSize(item.sizeBytes)}</TableCell>
                    <TableCell onClick={() => void onOpenPreview(item)}>{formatDate(item.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={disabled}
                          onClick={() => askRename(item)}
                          aria-label={`Endre navn pa ${item.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={disabled}
                          onClick={() => void onDelete(item)}
                          aria-label={`Slett ${item.name}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Endre navn pa dokument</DialogTitle>
            <DialogDescription>Skriv inn nytt navn.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void onRename()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Avbryt
            </Button>
            <Button onClick={() => void onRename()} disabled={!renameValue.trim()}>
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewTarget)} onOpenChange={(open) => !open && setPreviewTarget(null)}>
        <DialogContent className="flex h-[90vh] w-[96vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{previewTarget?.name ?? "Forhandsvisning"}</DialogTitle>
            <DialogDescription>Innhold i valgt fil.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden bg-muted/20 p-3">
            {previewLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Laster innhold...</p>
            ) : previewText !== null ? (
              <div className="h-full overflow-auto rounded border bg-background">
                <pre className="whitespace-pre-wrap break-words p-3 text-xs">{previewText}</pre>
              </div>
            ) : isImage && previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <div className="h-full overflow-auto rounded border bg-background/70 p-2">
                <img
                  src={previewUrl}
                  alt={previewTarget?.name ?? "Dokument"}
                  className="mx-auto h-full w-full object-contain"
                />
              </div>
            ) : isPdf && previewUrl ? (
              <div className="h-full overflow-hidden rounded border bg-background">
                <iframe
                  title={previewTarget?.name ?? "PDF"}
                  src={previewUrl}
                  className="h-full w-full border-0"
                />
              </div>
            ) : isVideo && previewUrl ? (
              <div className="flex h-full items-center justify-center rounded border bg-background p-3">
                <video src={previewUrl} controls className="max-h-full max-w-full rounded" />
              </div>
            ) : isAudio && previewUrl ? (
              <div className="flex h-full items-center justify-center rounded border bg-background p-6">
                <audio src={previewUrl} controls className="w-full max-w-xl" />
              </div>
            ) : previewUrl ? (
              <div className="flex h-full flex-col items-start justify-center gap-3 rounded border bg-background p-4 text-sm">
                <p>Forhandsvisning er ikke tilgjengelig for denne filtypen.</p>
                <Button asChild>
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    Apne fil i ny fane
                  </a>
                </Button>
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Ingen filinnhold tilgjengelig.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
