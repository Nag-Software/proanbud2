"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  createDeviationAction,
  getAccessibleProjectsAction,
  uploadDeviationPhotoAction,
} from "@/app/avvik/actions"
import { PhotoCaptureField } from "@/components/hms/photo-capture-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  DEVIATION_TYPES,
  DEVIATION_TYPE_HINTS,
  DEVIATION_TYPE_LABELS,
  type DeviationType,
} from "@/lib/hms/constants"

export function NewDeviationForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedProject = searchParams.get("projectId") || ""

  const [projects, setProjects] = React.useState<Array<{ id: string; name: string }>>([])
  const [projectId, setProjectId] = React.useState(preselectedProject)
  const [type, setType] = React.useState<DeviationType>("ruh")
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [locationText, setLocationText] = React.useState("")
  const [photos, setPhotos] = React.useState<File[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    void getAccessibleProjectsAction().then((data) => {
      setProjects(data.map((p) => ({ id: p.id, name: p.name })))
      if (!projectId && data[0]) setProjectId(data[0].id)
    })
  }, [projectId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) {
      toast.error("Velg prosjekt")
      return
    }

    setSubmitting(true)
    try {
      const created = await createDeviationAction({
        projectId,
        type,
        title,
        description,
        locationText,
      })

      for (const photo of photos) {
        const formData = new FormData()
        formData.append("deviationId", created.id)
        formData.append("file", photo)
        await uploadDeviationPhotoAction(formData)
      }

      toast.success("Avvik registrert")
      router.push(`/avvik/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke registrere avvik")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-xl space-y-5 pb-24">
      <div className="space-y-2">
        <Label>Prosjekt</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="Velg prosjekt" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => setType(v as DeviationType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEVIATION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {DEVIATION_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{DEVIATION_TYPE_HINTS[type]}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Hva skjedde?</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Kort tittel"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Beskrivelse</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Beskriv hendelsen..."
          rows={4}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Sted (valgfritt)</Label>
        <Input
          id="location"
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          placeholder="F.eks. 2. etasje"
        />
      </div>

      <div className="space-y-2">
        <Label>Bilder</Label>
        <PhotoCaptureField onPhotosChange={setPhotos} maxPhotos={3} />
      </div>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <Button type="submit" className="w-full" size="lg" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Send avvik
        </Button>
      </div>
    </form>
  )
}
