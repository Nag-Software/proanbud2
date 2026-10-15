"use client"

import * as React from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"

const BREDDE = 320
const HOYDE = 210
const MARG = 12

/** Plasserer kortet ved klikket, men alltid helt innenfor vinduet. */
export function plasserKort(punkt: { x: number; y: number }, vindu: { w: number; h: number }) {
  const x = Math.min(Math.max(MARG, punkt.x + 8), vindu.w - BREDDE - MARG)
  // Under klikket hvis det er plass, ellers over.
  const y = punkt.y + 8 + HOYDE <= vindu.h - MARG ? punkt.y + 8 : Math.max(MARG, punkt.y - HOYDE - 8)
  return { left: Math.max(MARG, x), top: y }
}

/** «tirsdag 14. okt. · 09:00–10:00», eller med begge datoer når avtalen går over flere dager. */
export function tidTekst(start: Date, slutt: Date) {
  const dag = format(start, "EEEE d. MMM", { locale: nb })
  if (format(start, "yyyy-MM-dd") === format(slutt, "yyyy-MM-dd")) {
    return `${dag} · ${format(start, "HH:mm")}–${format(slutt, "HH:mm")}`
  }
  return `${dag} ${format(start, "HH:mm")} – ${format(slutt, "EEEE d. MMM HH:mm", { locale: nb })}`
}

/**
 * Hurtigopprett i kalenderen (PC): et lite kort ved klikket med bare tittel og
 * prosjekt. Enter lagrer, Esc eller klikk utenfor lukker, og «Flere valg» åpner
 * hele dialogen med det du har skrevet.
 */
export function HurtigAvtale({
  punkt,
  start,
  slutt,
  tittel,
  onTittel,
  prosjekt,
  onProsjekt,
  prosjekter,
  lagrer,
  onLagre,
  onFlereValg,
  onLukk,
}: {
  punkt: { x: number; y: number }
  start: Date
  slutt: Date
  tittel: string
  onTittel: (v: string) => void
  prosjekt: string
  onProsjekt: (v: string) => void
  prosjekter: Array<{ id: string; name: string }>
  lagrer: boolean
  onLagre: () => void
  onFlereValg: () => void
  onLukk: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [plass] = React.useState(() =>
    plasserKort(punkt, { w: typeof window === "undefined" ? 1280 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight })
  )

  // Siste onLukk uten å binde lytterne på nytt for hver tast i tittelen.
  const lukk = React.useRef(onLukk)
  React.useEffect(() => {
    lukk.current = onLukk
  })

  React.useEffect(() => {
    const ute = (e: PointerEvent) => {
      const mal = e.target as Element | null
      if (!mal || ref.current?.contains(mal)) return
      // Prosjektlista ligger i en egen portal; et klikk der er ikke «utenfor».
      if (mal.closest("[data-radix-popper-content-wrapper]")) return
      lukk.current()
    }
    const esc = (e: KeyboardEvent) => {
      // Esc i prosjektlista lukker bare lista.
      if (e.key === "Escape" && !document.querySelector("[data-radix-popper-content-wrapper]")) lukk.current()
    }
    // Neste tikk: klikket som åpnet kortet skal ikke lukke det igjen.
    const t = window.setTimeout(() => document.addEventListener("pointerdown", ute, true), 0)
    document.addEventListener("keydown", esc)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener("pointerdown", ute, true)
      document.removeEventListener("keydown", esc)
    }
  }, [])

  const kanLagre = tittel.trim().length > 0 && !lagrer

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Ny avtale"
      style={{ left: plass.left, top: plass.top, width: BREDDE }}
      className="fixed z-50 flex flex-col gap-2.5 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="pt-0.5 text-xs font-medium text-muted-foreground first-letter:uppercase">{tidTekst(start, slutt)}</p>
        <Button type="button" variant="ghost" size="icon" className="-mt-1 -mr-1 size-7" aria-label="Lukk" onClick={onLukk}>
          <XIcon className="size-4" />
        </Button>
      </div>
      <Input
        autoFocus
        aria-label="Tittel"
        placeholder="Tittel, f.eks. Befaring"
        value={tittel}
        onChange={(e) => onTittel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && kanLagre) {
            e.preventDefault()
            onLagre()
          }
        }}
        className="h-9"
      />
      {prosjekter.length > 0 && (
        <SearchableSelect
          className="h-9"
          value={prosjekt || "none"}
          onChange={(v) => onProsjekt(v === "none" ? "" : v)}
          searchPlaceholder="Søk etter prosjekt…"
          options={[{ value: "none", label: "Uten prosjekt" }, ...prosjekter.map((p) => ({ value: p.id, label: p.name }))]}
        />
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onFlereValg}>
          Flere valg
        </Button>
        <Button type="button" size="sm" disabled={!kanLagre} onClick={onLagre}>
          {lagrer ? "Lagrer…" : "Lagre"}
        </Button>
      </div>
    </div>
  )
}
