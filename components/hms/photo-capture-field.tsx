"use client"

import * as React from "react"
import { Camera, ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { reportClientError } from "@/lib/errors/client"
import { DEVIATION_PHOTO_MAX_WIDTH } from "@/lib/hms/constants"

type PhotoPreview = {
  id: string
  file: File
  previewUrl: string
}

type Props = {
  onPhotosChange: (files: File[]) => void
  maxPhotos?: number
  disabled?: boolean
  /** Maks bredde i px før opplasting (standard: avvik-grense) */
  maxImageWidth?: number
}

async function prepareImage(
  file: File,
  maxWidth: number,
  maxSizeBytes = 2 * 1024 * 1024
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img

      if (width > maxWidth) {
        height = Math.round((height / width) * maxWidth)
        width = maxWidth
      }

      const needsResize = width !== img.width || height !== img.height
      const needsCompress = file.size > maxSizeBytes

      if (!needsResize && !needsCompress && file.type === "image/jpeg") {
        resolve(file)
        return
      }

      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(file)
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      const tryQuality = (quality: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file)
              return
            }
            if (blob.size > maxSizeBytes && quality > 0.5) {
              tryQuality(quality - 0.15)
              return
            }
            resolve(
              new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" })
            )
          },
          "image/jpeg",
          quality
        )
      }

      tryQuality(0.85)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Kunne ikke lese bilde"))
    }

    img.src = url
  })
}

export function PhotoCaptureField({
  onPhotosChange,
  maxPhotos = 5,
  disabled,
  maxImageWidth = DEVIATION_PHOTO_MAX_WIDTH,
}: Props) {
  const [photos, setPhotos] = React.useState<PhotoPreview[]>([])
  const [compressing, setCompressing] = React.useState(false)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)
  const galleryInputRef = React.useRef<HTMLInputElement>(null)
  const onPhotosChangeRef = React.useRef(onPhotosChange)

  React.useEffect(() => {
    onPhotosChangeRef.current = onPhotosChange
  }, [onPhotosChange])

  React.useEffect(() => {
    onPhotosChangeRef.current(photos.map((p) => p.file))
  }, [photos])

  // Hold en ref til gjeldende bilder så cleanup kun rydder opp ved avmontering
  // (ikke ved hver endring). Da overlever previewUrl-en en "Angre"-gjenoppretting.
  const photosRef = React.useRef(photos)
  React.useEffect(() => {
    photosRef.current = photos
  }, [photos])

  React.useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || disabled) return

    const remaining = maxPhotos - photos.length
    if (remaining <= 0) {
      toast.error(`Maks ${maxPhotos} bilder`)
      return
    }

    const files = Array.from(fileList).slice(0, remaining)
    setCompressing(true)

    try {
      const newPhotos: PhotoPreview[] = []

      for (const file of files) {
        if (!file.type.startsWith("image/")) continue
        const prepared = await prepareImage(file, maxImageWidth)
        newPhotos.push({
          id: `${Date.now()}-${Math.random()}`,
          file: prepared,
          previewUrl: URL.createObjectURL(prepared),
        })
      }

      setPhotos((prev) => [...prev, ...newPhotos])
    } catch (err) {
      reportClientError(err, { context: { action: "Behandle bilde (avvik)" } })
      toast.error("Kunne ikke behandle bilde")
    } finally {
      setCompressing(false)
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const index = prev.findIndex((p) => p.id === id)
      if (index === -1) return prev
      const target = prev[index]

      // Behold previewUrl-en så bildet kan gjenopprettes ved "Angre".
      // Den ryddes opp av cleanup-effekten når komponenten avmonteres.
      toast("Bilde fjernet", {
        action: {
          label: "Angre",
          onClick: () => {
            setPhotos((current) => {
              if (current.some((p) => p.id === target.id)) return current
              const restored = [...current]
              restored.splice(Math.min(index, restored.length), 0, target)
              return restored
            })
          },
        },
      })

      return prev.filter((p) => p.id !== id)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          disabled={disabled || compressing || photos.length >= maxPhotos}
          onClick={() => cameraInputRef.current?.click()}
        >
          {compressing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Camera className="mr-2 size-4" />
          )}
          Ta bilde
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          disabled={disabled || compressing || photos.length >= maxPhotos}
          onClick={() => galleryInputRef.current?.click()}
        >
          <ImagePlus className="mr-2 size-4" />
          Velg fra galleri
        </Button>
      </div>

      <input
        ref={cameraInputRef}
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
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ""
        }}
      />

      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt="Forhåndsvisning" className="size-full object-cover" />
              <button
                type="button"
                className="absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/60 text-white"
                onClick={() => removePhoto(photo.id)}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {photos.length}/{maxPhotos} bilder · maks {maxImageWidth}px bredde
      </p>
    </div>
  )
}
