"use client"

import * as React from "react"
import { Camera, ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

type PhotoPreview = {
  id: string
  file: File
  previewUrl: string
}

type Props = {
  onPhotosChange: (files: File[]) => void
  maxPhotos?: number
  disabled?: boolean
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

export function PhotoCaptureField({ onPhotosChange, maxPhotos = 5, disabled }: Props) {
  const [photos, setPhotos] = React.useState<PhotoPreview[]>([])
  const [compressing, setCompressing] = React.useState(false)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)
  const galleryInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    onPhotosChange(photos.map((p) => p.file))
  }, [photos, onPhotosChange])

  React.useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [photos])

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
        const compressed = await compressImage(file)
        newPhotos.push({
          id: `${Date.now()}-${Math.random()}`,
          file: compressed,
          previewUrl: URL.createObjectURL(compressed),
        })
      }

      setPhotos((prev) => [...prev, ...newPhotos])
    } catch {
      toast.error("Kunne ikke behandle bilde")
    } finally {
      setCompressing(false)
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
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
                className="absolute right-1 top-1 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/60 text-white"
                onClick={() => removePhoto(photo.id)}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {photos.length}/{maxPhotos} bilder. Bilder komprimeres automatisk.
      </p>
    </div>
  )
}
