"use client"

import { useCallback, useState } from "react"
import { Upload, X } from "lucide-react"
import { useDropzone } from "react-dropzone"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type FileDropzoneFieldProps = {
  label: string
  files: File[]
  onChange: (files: File[]) => void
  hint?: string
}

const maxFileSizeMb = 25
const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024

function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

export function FileDropzoneField({ label, files, onChange, hint }: FileDropzoneFieldProps) {
  const [dropError, setDropError] = useState<string | null>(null)

  const mergeFiles = useCallback(
    (incoming: File[]) => {
      const nextMap = new Map<string, File>()

      files.forEach((file) => {
        nextMap.set(getFileKey(file), file)
      })

      incoming.forEach((file) => {
        nextMap.set(getFileKey(file), file)
      })

      onChange(Array.from(nextMap.values()))
    },
    [files, onChange]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    maxSize: maxFileSizeBytes,
    onDrop: (accepted, rejected) => {
      setDropError(null)

      if (accepted.length > 0) {
        mergeFiles(accepted)
      }

      if (rejected.length > 0) {
        setDropError(`Noen filer ble avvist. Maks filstorrelse er ${maxFileSizeMb} MB per fil.`)
      }
    },
    onError: () => {
      setDropError("Kunne ikke laste inn valgte filer")
    },
  })

  const removeFile = (targetFile: File) => {
    const targetKey = getFileKey(targetFile)
    onChange(files.filter((file) => getFileKey(file) !== targetKey))
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div
        {...getRootProps()}
        className={cn(
          "rounded-lg border-2 border-dashed p-5 transition-colors",
          isDragActive ? "border-primary/60 bg-primary/5" : "border-border bg-muted/30"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-center">
          <Upload className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Dra filer hit eller trykk for å laste opp</p>
          <p className="text-xs text-muted-foreground">
            {hint || `PDF, bilder, DOCX og andre relevante filer (maks ${maxFileSizeMb} MB)`}
          </p>
        </div>
      </div>

      {dropError ? <p className="text-sm text-destructive">{dropError}</p> : null}

      {files.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          {files.map((file) => (
            <div
              key={getFileKey(file)}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => removeFile(file)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
