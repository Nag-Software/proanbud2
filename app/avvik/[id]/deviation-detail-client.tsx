"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { closeDeviationAction, getDeviationPhotoUrlAction } from "@/app/avvik/actions"
import {
  DeviationStatusBadge,
  DeviationTypeBadge,
} from "@/components/hms/deviation-badges"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  deviation: DeviationWithRelations
  canManage: boolean
}

function PhotoGallery({ attachments }: { attachments: DeviationWithRelations["attachments"] }) {
  const [urls, setUrls] = React.useState<Record<string, string>>({})

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
  }, [attachments])

  if (!attachments?.length) return null

  return (
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
            <img src={urls[att.id]} alt={att.file_name} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted text-xs">Laster...</div>
          )}
        </a>
      ))}
    </div>
  )
}

export function DeviationDetailClient({ deviation, canManage }: Props) {
  const [followUpNotes, setFollowUpNotes] = React.useState(deviation.follow_up_notes || "")
  const [busy, setBusy] = React.useState(false)

  async function handleClose() {
    setBusy(true)
    try {
      await closeDeviationAction({ id: deviation.id, followUpNotes })
      toast.success("Avvik lukket")
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lukke avvik")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{deviation.reference_number}</span>
          <DeviationTypeBadge type={deviation.type} />
          <DeviationStatusBadge status={deviation.status} />
        </div>
        <h1 className="text-2xl font-semibold">{deviation.title}</h1>
        {deviation.projects?.name && (
          <Link href={`/prosjekter/${deviation.project_id}`} className="text-sm text-primary hover:underline">
            {deviation.projects.name}
          </Link>
        )}
      </div>

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

      {deviation.attachments && deviation.attachments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Bilder</p>
          <PhotoGallery attachments={deviation.attachments} />
        </div>
      )}

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

      <Button variant="outline" asChild>
        <a href={`/api/avvik/${deviation.id}/pdf`} target="_blank" rel="noreferrer">
          Last ned PDF
        </a>
      </Button>
    </div>
  )
}
