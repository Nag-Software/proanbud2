"use client"

import * as React from "react"
import { Home } from "lucide-react"

import { cn } from "@/lib/utils"

type ProjectPhotoProps = {
  projectId: string
  /** Adressen bildet viser — brukes som alt-tekst og som «har vi noe å hente»-sjekk. */
  address: string | null
  className?: string
}

/**
 * Bilde av byggeplassen på et prosjektkort. Henter fra /api/prosjekter/[id]/bilde,
 * som slår opp adressen og bildekilden server-side.
 *
 * Har prosjektet ingen adresse spør vi ikke i det hele tatt — da vises
 * plassholderen med én gang i stedet for et request som uansett gir 404.
 */
export function ProjectPhoto({ projectId, address, className }: ProjectPhotoProps) {
  const [state, setState] = React.useState<"loading" | "ready" | "missing">(
    address ? "loading" : "missing"
  )

  // Bildet ligger et døgn i nettleser-cachen. Rettes adressen skal det nye bildet
  // opp med en gang, så adressen får henge på som cache-nøkkel — ruten leser den
  // uansett fra databasen og bryr seg ikke om verdien.
  const src = address
    ? `/api/prosjekter/${projectId}/bilde?v=${addressFingerprint(address)}`
    : null

  return (
    <div
      className={cn(
        "relative w-full shrink-0 overflow-hidden bg-muted/50",
        // Fast høydeforhold uansett tilstand, slik at kortene ikke hopper når
        // bildene lander etter hverandre.
        "aspect-[16/10]",
        className
      )}
    >
      {src && state !== "missing" && (
        // Vanlig <img>: ruten leverer allerede et ferdig skalert bilde, så
        // next/image ville bare lagt på et optimaliseringsledd uten gevinst.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Bilde av ${address}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("missing")}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            state === "ready" ? "opacity-100" : "opacity-0"
          )}
        />
      )}

      {state !== "ready" && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-muted/40",
            state === "loading" && "animate-pulse"
          )}
          aria-hidden
        >
          {state === "missing" && <Home className="h-6 w-6 text-muted-foreground/40" />}
        </div>
      )}

      {/* Mykner overgangen mot kortet og gir kontrast bak meny-knappen. */}
      {state === "ready" && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/25 to-transparent"
          aria-hidden
        />
      )}
    </div>
  )
}

/** Kort, stabil streng per adresse — kun ment som cache-nøkkel, ikke sikkerhet. */
function addressFingerprint(address: string) {
  let hash = 0
  for (let i = 0; i < address.length; i++) {
    hash = (hash * 31 + address.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
