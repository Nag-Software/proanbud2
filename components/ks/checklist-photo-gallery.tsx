"use client"

import * as React from "react"
import { Images } from "lucide-react"

import { getChecklistPhotoUrlAction, getProjectChecklistPhotosAction } from "@/app/ks/actions"

type PhotoEntry = Awaited<ReturnType<typeof getProjectChecklistPhotosAction>>[number]

export function ChecklistPhotoGallery({ projectId }: { projectId: string }) {
  const [photos, setPhotos] = React.useState<PhotoEntry[]>([])
  const [urls, setUrls] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    void getProjectChecklistPhotosAction(projectId)
      .then(setPhotos)
      .finally(() => setLoading(false))
  }, [projectId])

  React.useEffect(() => {
    async function loadUrls() {
      const next: Record<string, string> = {}
      for (const photo of photos) {
        const url = await getChecklistPhotoUrlAction(photo.storage_path)
        if (url) next[photo.id] = url
      }
      setUrls(next)
    }
    if (photos.length) void loadUrls()
  }, [photos])

  if (loading || photos.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Images className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Alle KS-bilder ({photos.length})</h4>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {photos.map((photo) => {
          const item = photo.item as {
            title: string
            checklist: { name: string } | { name: string }[]
          } | null
          const checklist = item?.checklist
            ? Array.isArray(item.checklist)
              ? item.checklist[0]
              : item.checklist
            : null

          return (
            <a
              key={photo.id}
              href={urls[photo.id] || "#"}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-lg border"
            >
              <div className="aspect-square bg-muted">
                {urls[photo.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urls[photo.id]}
                    alt={photo.file_name}
                    className="size-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                    Laster...
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium">{item?.title}</p>
                <p className="truncate text-xs text-muted-foreground">{checklist?.name}</p>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
