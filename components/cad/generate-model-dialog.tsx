"use client"

/**
 * «Generer modell»-dialogen.
 *
 * Her legger brukeren inn bildene KI-en skal lese bygget ut fra, og kan gi
 * ekstra instruksjoner. Resultatet erstatter modellen i editoren, men lagres
 * IKKE automatisk — brukeren ser den først, og forrige versjon ligger uansett i
 * angre-stakken og i versjonshistorikken.
 */

import * as React from "react"
import Image from "next/image"
import { ImagePlus, Loader2, Sparkles, TriangleAlert, X } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type ReferenceImage = {
  id: string
  fileName: string | null
  url: string | null
}

export function GenerateModelDialog({
  open,
  onOpenChange,
  projectId,
  modelId,
  referenceImageCount,
  onGenerated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  modelId: string
  referenceImageCount: number
  onGenerated: (model: unknown) => void
}) {
  const [images, setImages] = React.useState<ReferenceImage[]>([])
  const [loadingImages, setLoadingImages] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [generating, setGenerating] = React.useState(false)
  const [instructions, setInstructions] = React.useState("")
  const [assumptions, setAssumptions] = React.useState<string[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const loadImages = React.useCallback(async () => {
    setLoadingImages(true)
    try {
      const response = await fetch(`/api/prosjekter/${projectId}/modell/bilder`)
      if (!response.ok) return
      const data = (await response.json()) as { images?: ReferenceImage[] }
      setImages(data.images ?? [])
    } finally {
      setLoadingImages(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (open) void loadImages()
  }, [loadImages, open])

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const formData = new FormData()
      for (const file of Array.from(files)) formData.append("files", file)

      const response = await fetch(`/api/prosjekter/${projectId}/modell/bilder`, {
        method: "POST",
        body: formData,
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        toast.error(data.error || "Kunne ikke laste opp bildene.")
        return
      }
      await loadImages()
      toast.success("Bildene er lastet opp")
    } catch {
      toast.error("Opplastingen feilet. Sjekk nettforbindelsen og prøv igjen.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const removeImage = async (referenceId: string) => {
    setImages((current) => current.filter((image) => image.id !== referenceId))
    await fetch(`/api/prosjekter/${projectId}/modell/bilder?referenceId=${referenceId}`, {
      method: "DELETE",
    })
  }

  const generate = async () => {
    setGenerating(true)
    setAssumptions([])
    try {
      const response = await fetch(`/api/prosjekter/${projectId}/modell/generer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: modelId || undefined,
          instructions: instructions.trim() || undefined,
          persist: false,
        }),
      })

      const data = (await response.json()) as {
        error?: string
        model?: unknown
        assumptions?: string[]
      }

      if (!response.ok || !data.model) {
        toast.error(data.error || "Kunne ikke generere modellen.")
        return
      }

      onGenerated(data.model)
      setAssumptions(data.assumptions ?? [])
      if ((data.assumptions ?? []).length === 0) {
        onOpenChange(false)
      }
    } catch {
      toast.error("Genereringen tok for lang tid eller feilet. Prøv igjen.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generer 3D-modell</DialogTitle>
          <DialogDescription>
            ProAnbud leser prosjektbeskrivelsen og bildene, og bygger et forslag du kan justere
            fritt etterpå.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Bilder av bygget eller tomta ({images.length || referenceImageCount})
            </Label>

            {loadingImages ? (
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : images.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {images.map((image) => (
                  <div key={image.id} className="group relative aspect-square overflow-hidden rounded-md border">
                    {image.url ? (
                      <Image
                        src={image.url}
                        alt={image.fileName || "Referansebilde"}
                        fill
                        sizes="120px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
                        Bilde
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeImage(image.id)}
                      className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 opacity-0 transition group-hover:opacity-100"
                      aria-label="Fjern bilde"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Ingen bilder ennå. Modellen lages da bare fra beskrivelsen — legg gjerne til bilder
                for et mer treffsikkert resultat.
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              Legg til bilder
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Ekstra instruksjoner (valgfritt)
            </Label>
            <Textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={3}
              placeholder="F.eks. «Bad skal ligge mot nord», «8 × 10 m», «to soverom og åpen stue/kjøkken»"
            />
          </div>

          {assumptions.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                <TriangleAlert className="size-3.5" />
                Dette er antatt — sjekk målene
              </p>
              <ul className="ml-4 list-disc space-y-0.5 text-xs text-muted-foreground">
                {assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Modellen erstattes i editoren, men lagres ikke før du trykker Lagre. Du kan alltid angre.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Lukk
          </Button>
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Bygger modellen …" : "Generer modell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
