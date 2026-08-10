"use client"

/**
 * Bilder som 3D-modellen skal genereres fra.
 *
 * Egen felttype i stedet for den generelle filslippsonen: her er miniatyrbildet
 * hele poenget. Brukeren må kunne se at det er RIKTIG fasadebilde han la ved,
 * før prosjektet opprettes.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Camera, X } from "lucide-react"
import { useDropzone } from "react-dropzone"

import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

const MAX_PHOTOS = 8
const MAX_SIZE_MB = 20

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

export function ModelPhotosField({
  files,
  onChange,
  generateModel,
  onGenerateModelChange,
}: {
  files: File[]
  onChange: (files: File[]) => void
  generateModel: boolean
  onGenerateModelChange: (value: boolean) => void
}) {
  const [dropError, setDropError] = useState<string | null>(null)

  // Miniatyrbildene utledes av filene i stedet for å speiles i egen state.
  // Object-URL-ene må frigis når lista endrer seg, ellers holder nettleseren
  // på hver eneste fil brukeren har vært innom så lenge fanen lever.
  const previews = useMemo(
    () => files.map((file) => ({ key: fileKey(file), file, url: URL.createObjectURL(file) })),
    [files]
  )

  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url)
    },
    [previews]
  )

  const merge = useCallback(
    (incoming: File[]) => {
      const map = new Map<string, File>()
      for (const file of files) map.set(fileKey(file), file)
      for (const file of incoming) map.set(fileKey(file), file)
      const next = Array.from(map.values()).slice(0, MAX_PHOTOS)
      if (map.size > MAX_PHOTOS) {
        setDropError(`Vi bruker de ${MAX_PHOTOS} første bildene.`)
      }
      onChange(next)
    },
    [files, onChange]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    maxSize: MAX_SIZE_MB * 1024 * 1024,
    onDrop: (accepted, rejected) => {
      setDropError(null)
      if (accepted.length > 0) merge(accepted)
      if (rejected.length > 0) {
        setDropError(`Noen filer ble avvist. Bruk bilder på maks ${MAX_SIZE_MB} MB.`)
      }
    },
  })

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">3D-modell av prosjektet</p>
          <p className="text-sm text-muted-foreground">
            Legg ved bilder av bygget, tomta eller en skisse. ProAnbud bygger en 3D-modell fra
            bildene og beskrivelsen, som du kan justere fritt etterpå.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch checked={generateModel} onCheckedChange={onGenerateModelChange} />
          <span className="text-muted-foreground">Lag modell automatisk</span>
        </label>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition",
          isDragActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
        )}
      >
        <input {...getInputProps()} />
        <Camera className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Slipp bilder her, eller klikk for å velge</p>
        <p className="text-xs text-muted-foreground">
          Maks {MAX_PHOTOS} bilder · JPG, PNG eller HEIC · inntil {MAX_SIZE_MB} MB per bilde
        </p>
      </div>

      {dropError && <p className="text-xs text-destructive">{dropError}</p>}

      {previews.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {previews.map((preview) => (
            <div
              key={preview.key}
              className="group relative aspect-square overflow-hidden rounded-md border bg-background"
            >
              {/* Lokal object-URL — next/image gir ingenting her, og ville
                  krevd at vi hvitelistet blob: i bildekonfigurasjonen. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.url}
                alt={preview.file.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(files.filter((item) => fileKey(item) !== preview.key))}
                className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Fjern ${preview.file.name}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!generateModel && (
        <p className="text-xs text-muted-foreground">
          Modellen lages ikke nå. Du kan starte genereringen når som helst fra fanen 3D-modell på
          prosjektet.
        </p>
      )}
    </div>
  )
}
