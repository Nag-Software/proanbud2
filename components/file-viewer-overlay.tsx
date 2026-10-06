"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { ExternalLink, X } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Fullskjerm bildeviser for mobil (web og Proanbud-appen).
 *
 * På små skjermer åpnet dokumentbiblioteket filer med window.open. I appen
 * finnes det ikke «nye vinduer»: WebViewen navigerte til selve fil-URL-en, og
 * brukeren sto igjen med et bilde uten X, uten topplinje og uten vei tilbake.
 * Her vises bildet oppå siden, med tydelig Lukk; Escape og trykk utenfor
 * bildet lukker også. (Ingen historikk-triks: Next-ruteren eier history, og
 * pushState/popstate herfra ble upålitelig.) PDF og andre formater går
 * fortsatt på toppnivå (WebKit tegner PDF i iframe som én side uten rulling),
 * og der gir app-skallet en egen Tilbake-rad.
 */
export function FileViewerOverlay({
  name,
  url,
  onClose,
}: {
  name: string
  url: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[70] flex flex-col bg-black text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Lukk"
          onClick={onClose}
          className="size-10 text-white hover:bg-white/15 hover:text-white"
        >
          <X className="size-6" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Åpne i nettleser"
          onClick={() => window.open(url, "_blank", "noreferrer")}
          className="size-10 text-white hover:bg-white/15 hover:text-white"
        >
          <ExternalLink className="size-5" />
        </Button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2"
        // Klype-zoom på bildet, uten at hele siden zoomer.
        style={{ touchAction: "pinch-zoom" }}
        onClick={(e) => {
          // Trykk på det svarte rundt bildet lukker også — vanlig bildeviser-grep.
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    </div>,
    document.body
  )
}
