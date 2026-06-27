"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  closeDeviationAction,
  getDeviationPhotoUrlAction,
  reopenDeviationAction,
  uploadDeviationPhotoAction,
} from "@/app/avvik/actions"
import {
  DeviationStatusBadge,
  DeviationTypeBadge,
} from "@/components/hms/deviation-badges"
import { PhotoCaptureField } from "@/components/hms/photo-capture-field"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  deviation: DeviationWithRelations
  canManage: boolean
}

function PhotoGallery({
  attachments,
  onUpload,
  resetKey,
}: {
  attachments: DeviationWithRelations["attachments"]
  onUpload: (files: File[]) => Promise<void>
  resetKey: number
}) {
  const [urls, setUrls] = React.useState<Record<string, string>>({})
  const [uploading, setUploading] = React.useState(false)
  const attachmentIds = (attachments || []).map((a) => a.id).join(",")

  React.useEffect(() => {
    async function load() {
      if (!attachments?.length) return
      const next: Record<string, string> = {}
      for (const att of attachments) {
        const url = await getDeviationPhotoUrlAction(att.storage_path)
        if (url) next[att.id] = url
      }
      setUrls(next)
    }
    void load()
  }, [attachmentIds, attachments])

  const handlePhotos = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setUploading(true)
      try {
        await onUpload(files)
      } finally {
        setUploading(false)
      }
    },
    [onUpload]
  )

  return (
    <div className="space-y-3">
      {attachments && attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {attachments.map((att) => (
            <a
              key={att.id}
              href={urls[att.id] || "#"}
              target="_blank"
              rel="noreferrer"
              className="aspect-square overflow-hidden rounded-lg border"
            >
              {urls[att.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[att.id]}
                  alt={att.file_name}
                  className="size-full max-w-[1200px] object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center bg-muted text-xs">
                  Laster...
                </div>
              )}
            </a>
          ))}
        </div>
      )}
      <PhotoCaptureField
        key={resetKey}
        onPhotosChange={handlePhotos}
        maxPhotos={5}
        disabled={uploading}
      />
      {uploading && (
        <p className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Laster opp...
        </p>
      )}
    </div>
  )
}

export function DeviationDetailClient({ deviation, canManage }: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const [followUpNotes, setFollowUpNotes] = React.useState(deviation.follow_up_notes || "")
  const [busy, setBusy] = React.useState(false)
  const [galleryKey, setGalleryKey] = React.useState(0)

  async function handleClose() {
    setBusy(true)
    try {
      await closeDeviationAction({ id: deviation.id, followUpNotes })
      toast.success("Avvik lukket")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lukke avvik")
    } finally {
      setBusy(false)
    }
  }

  async function handleReopen() {
    const ok = await confirm({
      title: "Gjenåpne avvik?",
      description: "Avviket settes tilbake til åpen og kan følges opp på nytt.",
      confirmText: "Gjenåpne",
    })
    if (!ok) return
    setBusy(true)
    try {
      await reopenDeviationAction(deviation.id)
      toast.success("Avvik gjenåpnet")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke gjenåpne avvik")
    } finally {
      setBusy(false)
    }
  }

  const handlePhotoUpload = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      for (const file of files) {
        const formData = new FormData()
        formData.append("deviationId", deviation.id)
        formData.append("file", file)
        await uploadDeviationPhotoAction(formData)
      }
      toast.success("Bilde lastet opp")
      setGalleryKey((k) => k + 1)
      router.refresh()
    },
    [deviation.id, router]
  )

  const checklistItem = deviation.checklist_item
  const checklist = checklistItem?.checklist
    ? Array.isArray(checklistItem.checklist)
      ? checklistItem.checklist[0]
      : checklistItem.checklist
    : null

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{deviation.reference_number}</span>
          <DeviationTypeBadge type={deviation.type} />
          <DeviationStatusBadge status={deviation.status} />
          {deviation.source === "checklist" && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              Fra sjekkliste
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold">{deviation.title}</h1>
        {deviation.projects?.name && (
          <Link
            href={`/prosjekter/${deviation.project_id}`}
            className="text-sm text-primary hover:underline"
          >
            {deviation.projects.name}
          </Link>
        )}
      </div>

      {checklistItem && checklist && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
          <p className="text-sm font-medium">Koblet til sjekkliste</p>
          <p className="text-sm text-muted-foreground">
            {checklist.name} — {checklistItem.title}
          </p>
          <Button variant="link" className="h-auto p-0 text-sm" asChild>
            <Link href={`/prosjekter/${checklist.project_id}/ks/${checklist.id}`}>
              Gå til sjekkliste
            </Link>
          </Button>
        </div>
      )}

      <div className="rounded-lg border p-4 space-y-3 text-sm">
        <p className="whitespace-pre-wrap">{deviation.description}</p>
        {deviation.location_text && (
          <p className="text-muted-foreground">Sted: {deviation.location_text}</p>
        )}
        <p className="text-muted-foreground">
          Meldt av {deviation.reporter?.full_name || "ukjent"} ·{" "}
          {new Date(deviation.created_at).toLocaleString("no-NO")}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Bilder</p>
        <PhotoGallery
          attachments={deviation.attachments}
          onUpload={handlePhotoUpload}
          resetKey={galleryKey}
        />
      </div>

      {deviation.follow_up_notes && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Oppfølging</p>
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
            {deviation.follow_up_notes}
          </p>
        </div>
      )}

      {canManage && deviation.status === "open" && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="space-y-2">
            <Label>Oppfølging (valgfritt)</Label>
            <Textarea
              value={followUpNotes}
              onChange={(e) => setFollowUpNotes(e.target.value)}
              placeholder="Hva ble gjort?"
              rows={3}
            />
          </div>
          <Button onClick={handleClose} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Lukk avvik
          </Button>
        </div>
      )}

      {canManage && deviation.status === "closed" && (
        <div className="rounded-lg border p-4">
          <Button variant="outline" onClick={handleReopen} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Gjenåpne avvik
          </Button>
        </div>
      )}

      <Button variant="outline" asChild>
        <a href={`/api/avvik/${deviation.id}/pdf`} target="_blank" rel="noreferrer">
          Last ned PDF
        </a>
      </Button>
    </div>
  )
}
