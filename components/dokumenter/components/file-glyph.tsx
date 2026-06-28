"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { fileVisual, isImage } from "../utils"
import type { DocumentItem } from "../types"

type Props = {
  item: DocumentItem
  className?: string
  /** Show an image thumbnail (falls back to the type icon on error / no URL). */
  thumb?: boolean
}

export function FileGlyph({ item, className = "h-4 w-4", thumb = false }: Props) {
  const [errored, setErrored] = useState(false)
  const { Icon, colorClass } = fileVisual(item)
  const url = item.downloadUrl ?? item.webUrl

  if (thumb && isImage(item) && url && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className={cn("rounded object-cover", className)}
      />
    )
  }

  return <Icon className={cn(colorClass, className)} aria-hidden="true" />
}
