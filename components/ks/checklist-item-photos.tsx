"use client"

import * as React from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import {
  deleteChecklistItemPhotoAction,
  getChecklistPhotoUrlAction,
  uploadChecklistItemPhotoAction,
} from "@/app/ks/actions"
import { PhotoAnnotatorDialog } from "@/components/ks/photo-annotator"
import { Button } from "@/components/ui/button"
import type { ProjectChecklistItem } from "@/lib/ks/types"

type Props = {
  item: ProjectChecklistItem
  projectId: string
  checklistId: string
  onUpdated: () => void
}

async function compressImage(file: File, maxSizeBytes = 2 * 1024 * 1024): Promise<File> {
  if (file.size <= maxSizeBytes) return file

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement("canvas")
      let { width, height } = img
      const maxDim = 1920

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (height / width) * maxDim
          width = maxDim
        } else {
          width = (width / height) * maxDim
          height = maxDim
        }
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(file)
        return
      }

      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }))
        },
        "image/jpeg",
        0.85
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Kunne ikke lese bilde"))
    }

    img.src = url
  })
}

function PhotoThumb({
  attachment,
  onDelete,
  onAnnotate,
}: {
  attachment: NonNullable<ProjectChecklistItem["attachments"]>[number]
  onDelete: () => void
  onAnnotate: () => void
}) {
  const [url, setUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    void getChecklistPhotoUrlAction(attachment.storage_path).then(setUrl)
  }, [attachment.storage_path])

  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border">
      {url ? (
        <button type="button" onClick={onAnnotate} className="size-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={attachment.file_name} className="size-full object-cover" />
        </button>
      ) : (
        <div className="flex size-full items-center justify-center bg-muted text-xs">Laster...</div>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/90 shadow"
        aria-label="Slett bilde"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function ChecklistItemPhotos({ item, projectId, checklistId, onUpdated }: Props) {
  const [uploading, setUploading] = React.useState(false)
  const [annotateFile, setAnnotateFile] = React.useState<File | null>(null)
  const [annotateOpen, setAnnotateOpen] = React.useState(false)
  // Kø av gjenstående valgte bilder som skal annoteres/lastes opp sekvensielt
  const queueRef = React.useRef<File[]>([])
  // Settes mens vi med vilje åpner annotatoren for neste bilde i køen, slik at
  // det automatiske lukke-kallet fra annotatoren (etter lagring) ikke tømmer køen.
  const advancingRef = React.useRef(false)
  const cameraRef = React.useRef<HTMLInputElement>(null)
  const galleryRef = React.useRef<HTMLInputElement>(null)

  // Komprimer neste fil i køen og åpne annotatoren for den
  async function processNextInQueue() {
    const raw = queueRef.current.shift()
    if (!raw) return
    setUploading(true)
    try {
      const file = await compressImage(raw)
      setAnnotateFile(file)
      setAnnotateOpen(true)
    } catch {
      toast.error("Kunne ikke behandle bilde")
      // Hopp over denne og fortsett med resten av køen
      void processNextInQueue()
    } finally {
      setUploading(false)
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    // Legg alle valgte filer i køen og start på den første
    queueRef.current = Array.from(files)
    if (queueRef.current.length > 1) {
      toast.info(`${queueRef.current.length} bilder valgt — behandles ett av gangen`)
    }
    await processNextInQueue()
  }

  async function handleAnnotatedUpload(file: File, annotationJson: string) {
    const formData = new FormData()
    formData.append("itemId", item.id)
    formData.append("file", file)
    formData.append("annotationJson", annotationJson)
    await uploadChecklistItemPhotoAction(formData)
    toast.success("Bilde lagret")
    onUpdated()
    // Annotatoren lukker seg selv (onOpenChange(false)) etter at onSave er ferdig.
    // Hvis det fortsatt er bilder i køen, marker at vi skal videre slik at
    // lukke-handleren ikke tømmer køen, og åpne neste rett etterpå.
    if (queueRef.current.length > 0) {
      advancingRef.current = true
    }
  }

  async function handleDelete(attachmentId: string) {
    try {
      await deleteChecklistItemPhotoAction(attachmentId)
      toast.success("Bilde slettet")
      onUpdated()
    } catch {
      toast.error("Kunne ikke slette bilde")
    }
  }

  const attachments = item.attachments || []

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((att) => (
            <PhotoThumb
              key={att.id}
              attachment={att}
              onDelete={() => void handleDelete(att.id)}
              onAnnotate={() => {
                void getChecklistPhotoUrlAction(att.storage_path).then(async (url) => {
                  if (!url) return
                  const res = await fetch(url)
                  const blob = await res.blob()
                  setAnnotateFile(new File([blob], att.file_name, { type: blob.type }))
                  setAnnotateOpen(true)
                })
              }}
            />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ""
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ""
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 flex-1"
          disabled={uploading}
          onClick={() => cameraRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-2 size-4" />
          )}
          Ta bilde
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 flex-1"
          disabled={uploading}
          onClick={() => galleryRef.current?.click()}
        >
          Last opp
        </Button>
      </div>

      <PhotoAnnotatorDialog
        open={annotateOpen}
        onOpenChange={(open) => {
          if (!open && advancingRef.current) {
            // Lagring fullført og flere bilder i kø: gå videre til neste i stedet
            // for å lukke. Hold dialogen åpen og åpne neste bilde.
            advancingRef.current = false
            void processNextInQueue()
            return
          }
          setAnnotateOpen(open)
          // Avbryter brukeren annotatoren, forkast resten av køen
          if (!open) queueRef.current = []
        }}
        file={annotateFile}
        onSave={handleAnnotatedUpload}
      />
    </div>
  )
}
