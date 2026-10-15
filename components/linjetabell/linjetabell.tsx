"use client"

import * as React from "react"
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd"
import { ChevronDownIcon, GripVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Felles linjetabell for kalkylen og tilbudsgeneratoren: samme kolonner, samme
 * grå grupperad (post/kategori), redigering rett i cellene og dra-og-slipp av
 * linjer innen og mellom grupper. Tabellen kjenner ikke datamodellen; hver
 * bruker fyller cellene selv.
 */

export const KOLONNER = 9

/** Tall fra et tekstfelt med komma eller punktum. Tomt eller rart blir 0. */
export function lesTall(tekst: string): number {
  const n = parseFloat(tekst.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function formatTall(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString("nb-NO", { maximumFractionDigits: 2 })
}

export const celle =
  "h-7 w-full min-w-0 rounded bg-transparent px-1 text-sm outline-none transition-colors hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-ring/20 pointer-coarse:h-10"

/** Nedtrekk i en celle (type, enhet, timepris): så bred som innholdet. */
export const celleValg = cn(celle, "w-auto text-muted-foreground")

/** Tekst som redigeres rett i cellen. */
export function CelleTekst({
  value,
  onChange,
  label,
  placeholder,
  className,
  size,
  lagreVedBlur = false,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder?: string
  className?: string
  /** Bredde i tegn, for felt som skal vokse med innholdet. */
  size?: number
  /** Lagre først når feltet forlates (Enter eller klikk utenfor), ikke for hvert tegn. */
  lagreVedBlur?: boolean
}) {
  const [utkast, setUtkast] = React.useState<string | null>(null)
  const vist = lagreVedBlur ? (utkast ?? value) : value
  return (
    <input
      aria-label={label}
      value={vist}
      placeholder={placeholder}
      onFocus={() => lagreVedBlur && setUtkast(value)}
      onChange={(e) => (lagreVedBlur ? setUtkast(e.target.value) : onChange(e.target.value))}
      onBlur={() => {
        if (!lagreVedBlur || utkast === null) return
        if (utkast !== value) onChange(utkast)
        setUtkast(null)
      }}
      onKeyDown={(e) => {
        if (!lagreVedBlur) return
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          setUtkast(value)
          e.currentTarget.blur()
        }
      }}
      title={vist || undefined}
      size={size}
      className={cn(celle, "placeholder:text-muted-foreground/60", className)}
    />
  )
}

/** Tall i cellen: vises formatert, redigeres som rå tekst så «2,» ikke hopper. */
export function CelleTall({
  value,
  onChange,
  label,
  suffix,
  className,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  suffix?: string
  className?: string
}) {
  const [utkast, setUtkast] = React.useState<string | null>(null)
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={utkast ?? `${formatTall(value)}${suffix ?? ""}`}
      onFocus={() => setUtkast(formatTall(value))}
      onBlur={() => setUtkast(null)}
      onChange={(e) => {
        setUtkast(e.target.value)
        onChange(lesTall(e.target.value))
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
      className={cn(celle, "text-right tabular-nums", className)}
    />
  )
}

/** Typen på linja: farget prikk og en nedtrekksliste. */
export function TypeCelle<T extends string>({
  value,
  valg,
  prikk,
  label,
  onChange,
}: {
  value: T
  valg: Array<{ verdi: T; navn: string }>
  prikk: string
  label: string
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", prikk)} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(celleValg, "pr-1")}>
        {valg.map((v) => (
          <option key={v.verdi} value={v.verdi}>
            {v.navn}
          </option>
        ))}
      </select>
    </div>
  )
}

const MERKE_TONE = {
  ny: "border-[#d7e8bf] bg-[color:var(--surface-success)] text-[#4d7219]",
  anslag: "border-[#f0dcb4] bg-[color:var(--surface-warning)] text-[#8a5f1b]",
  noytral: "border-transparent bg-muted text-muted-foreground",
} as const

/** Små merker ved beskrivelsen: «Ny», «Anslått pris», leverandør. */
export function Merke({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof MERKE_TONE
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border px-1.5 text-[10px] font-semibold whitespace-nowrap",
        MERKE_TONE[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export type Flytting = {
  linjeId: string
  fraGruppe: string
  fraIndeks: number
  tilGruppe: string
  tilIndeks: number
}

const hode = "w-px px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"

/**
 * Tabellen på PC (fra lg). Barna er grupper (`LinjeGruppe`). Alle kolonner
 * unntatt Beskrivelse er så brede som innholdet (w-px); Beskrivelse tar resten,
 * men aldri under ca. 200 px. Er det ikke plass, ruller tabellen i stedet for å
 * kutte tekst.
 */
export function LinjeTabell({
  onFlytt,
  children,
  bunn,
  className,
}: {
  onFlytt: (f: Flytting) => void
  children: React.ReactNode
  /** Rad nederst, f.eks. «Ny post». */
  bunn?: React.ReactNode
  className?: string
}) {
  const slipp = (r: DropResult) => {
    if (!r.destination) return
    if (r.source.droppableId === r.destination.droppableId && r.source.index === r.destination.index) return
    onFlytt({
      linjeId: r.draggableId,
      fraGruppe: r.source.droppableId,
      fraIndeks: r.source.index,
      tilGruppe: r.destination.droppableId,
      tilIndeks: r.destination.index,
    })
  }
  return (
    <div className={cn("hidden w-full overflow-hidden rounded-lg border bg-background lg:block", className)}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-px px-0" />
              <TableHead className="w-full pl-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beskrivelse</TableHead>
              <TableHead className={hode}>Type</TableHead>
              <TableHead className={cn(hode, "text-right")}>Antall</TableHead>
              <TableHead className={hode}>Enhet</TableHead>
              <TableHead className={cn(hode, "text-right")}>Pris</TableHead>
              <TableHead className={cn(hode, "text-right")}>Påslag</TableHead>
              <TableHead className={cn(hode, "text-right")}>Linjesum</TableHead>
              <TableHead className="w-px px-1" />
            </TableRow>
          </TableHeader>
          <DragDropContext onDragEnd={slipp}>{children}</DragDropContext>
          {bunn && (
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={KOLONNER} className="p-1.5">
                  {bunn}
                </TableCell>
              </TableRow>
            </TableBody>
          )}
        </Table>
      </div>
    </div>
  )
}

type GruppeHodeProps = {
  navn: string
  onNavn: (navn: string) => void
  /** «1», «2» … foran navnet (kalkylens poster). */
  nr?: number
  antall: number
  timer?: number
  sum: string
  apen: boolean
  onBytt: () => void
  onSlett: () => void
  /** «posten», «kategorien». */
  hva: string
  /** Navnet er gruppens nøkkel (tilbudets kategorier): lagre først når feltet forlates. */
  lagreNavnVedBlur?: boolean
}

/** En post eller kategori: grå rad, linjene (dra-og-slipp) og knappene for å legge til. */
export function LinjeGruppe({
  id,
  leggTil,
  children,
  ...hodeProps
}: GruppeHodeProps & {
  /** Droppable-id, samme som `fraGruppe`/`tilGruppe` i `onFlytt`. */
  id: string
  leggTil?: React.ReactNode
  children: React.ReactNode
}) {
  const { navn, onNavn, nr, antall, timer, sum, apen, onBytt, onSlett, hva, lagreNavnVedBlur } = hodeProps
  const tom = React.Children.count(children) === 0
  return (
    <>
      <TableBody>
        <TableRow className="bg-muted/50 hover:bg-muted/70">
          <TableCell colSpan={KOLONNER} className="py-1.5 pl-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded hover:bg-muted"
                onClick={onBytt}
                aria-expanded={apen}
                aria-label={apen ? `Skjul ${navn}` : `Vis ${navn}`}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", !apen && "-rotate-90")}
                />
              </button>
              {nr != null && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{nr}</span>}
              {/* Bredde etter innholdet, så navnet ikke kuttes (store bokstaver er bredere, derav +3). */}
              <CelleTekst
                label={`Navn på ${hva}`}
                value={navn}
                onChange={onNavn}
                placeholder={`Navn på ${hva}`}
                size={Math.max(8, navn.length + 3)}
                lagreVedBlur={lagreNavnVedBlur}
                className="w-auto max-w-[min(32rem,100%)] min-w-0 flex-none text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              />
              <Badge variant="outline" className="h-4 rounded-sm px-1.5 text-[10px] font-normal">
                {antall}
              </Badge>
              {timer != null && timer > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">{formatTall(timer)} t</span>
              )}
              <span className="ml-auto text-sm font-semibold tabular-nums">{sum}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                aria-label={`Slett ${hva} ${navn}`}
                onClick={onSlett}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>

      {apen && (
        <Droppable droppableId={id}>
          {(provided, snapshot) => (
            <tbody
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={cn("[&_tr:last-child]:border-0", snapshot.isDraggingOver && "bg-primary/5")}
            >
              {tom && (
                <tr>
                  <td colSpan={KOLONNER} className="px-2 pt-2 pb-0">
                    <p className="rounded-md border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground">
                      Ingen linjer ennå. Dra linjer hit eller legg til under.
                    </p>
                  </td>
                </tr>
              )}
              {children}
              {provided.placeholder}
            </tbody>
          )}
        </Droppable>
      )}

      {apen && leggTil && (
        <TableBody>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={KOLONNER} className="p-1 pl-7">
              {leggTil}
            </TableCell>
          </TableRow>
        </TableBody>
      )}
    </>
  )
}

/** Én linje i tabellen. Cellene fylles av brukeren; håndtaket til venstre drar linja. */
export function LinjeRad({
  id,
  indeks,
  navn,
  beskrivelse,
  type,
  antall,
  enhet,
  pris,
  paslag,
  sum,
  onAapne,
  onSlett,
}: {
  id: string
  indeks: number
  /** Brukes i knappenes aria-label («Åpne Veggfliser»). */
  navn: string
  beskrivelse: React.ReactNode
  type: React.ReactNode
  antall: React.ReactNode
  enhet: React.ReactNode
  pris: React.ReactNode
  paslag: React.ReactNode
  sum: React.ReactNode
  onAapne: () => void
  onSlett: () => void
}) {
  return (
    <Draggable draggableId={id} index={indeks}>
      {(dra, s) => (
        <tr
          ref={dra.innerRef}
          {...dra.draggableProps}
          className={cn(
            "group/row border-b transition-colors hover:bg-muted/20",
            s.isDragging && "table bg-background shadow-md ring-1 ring-border"
          )}
        >
          <td className="w-px py-1.5 pr-0 pl-1 align-middle">
            <button
              type="button"
              {...dra.dragHandleProps}
              aria-label={`Flytt ${navn}`}
              className="flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground active:cursor-grabbing"
            >
              <GripVerticalIcon className="size-3.5" />
            </button>
          </td>
          <td className="py-1.5 pr-1 pl-0 align-middle">{beskrivelse}</td>
          <td className="px-1 py-1.5 align-middle">{type}</td>
          <td className="px-1 py-1.5 align-middle">{antall}</td>
          <td className="px-1 py-1.5 align-middle">{enhet}</td>
          <td className="px-1 py-1.5 text-right align-middle">{pris}</td>
          <td className="px-1 py-1.5 text-right align-middle text-sm tabular-nums text-muted-foreground">{paslag}</td>
          <td className="px-1 py-1.5 text-right align-middle text-sm font-semibold whitespace-nowrap tabular-nums">{sum}</td>
          <td className="py-1.5 pr-2 pl-0.5 align-middle">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-transparent group-hover/row:text-muted-foreground focus-visible:text-muted-foreground hover:!text-foreground"
                aria-label={`Åpne ${navn}`}
                onClick={onAapne}
              >
                <PencilIcon className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-transparent group-hover/row:text-muted-foreground focus-visible:text-muted-foreground hover:!text-destructive"
                aria-label={`Slett ${navn}`}
                onClick={onSlett}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          </td>
        </tr>
      )}
    </Draggable>
  )
}

// ── Mobil og nettbrett (under lg): kort med redigeringsark ──────────────────

export function GruppeKort({
  navn,
  antall,
  sum,
  apen,
  onBytt,
  children,
  leggTil,
}: {
  navn: string
  antall: number
  sum: string
  apen: boolean
  onBytt: () => void
  children: React.ReactNode
  leggTil?: React.ReactNode
}) {
  const tom = React.Children.count(children) === 0
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 bg-muted/50 px-3 py-2.5 text-left"
        onClick={onBytt}
        aria-expanded={apen}
        aria-label={apen ? `Skjul ${navn}` : `Vis ${navn}`}
      >
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", !apen && "-rotate-90")} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {navn || "Uten navn"}
        </span>
        <Badge variant="outline" className="h-4 rounded-sm px-1.5 text-[10px] font-normal">
          {antall}
        </Badge>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{sum}</span>
      </button>
      {apen && (
        <>
          {tom ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Ingen linjer ennå.</p>
          ) : (
            <div className="divide-y">{children}</div>
          )}
          {leggTil && <div className="border-t px-1.5 py-1">{leggTil}</div>}
        </>
      )}
    </div>
  )
}

export function LinjeKort({
  navn,
  merker,
  prikk,
  detalj,
  sum,
  onAapne,
  onSlett,
}: {
  navn: string
  merker?: React.ReactNode
  prikk: string
  detalj: React.ReactNode
  sum: string
  onAapne: () => void
  onSlett: () => void
}) {
  return (
    <div className="flex items-stretch">
      {/* Hele kortet er trykkflaten for redigering, lettere å treffe enn et lite ikon. */}
      <button
        type="button"
        className="min-w-0 flex-1 py-3 pr-1 pl-3 text-left transition-colors active:bg-muted/60"
        onClick={onAapne}
        aria-label={`Rediger ${navn}`}
      >
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1 text-sm leading-snug font-medium">
            {navn}
            {merker && <span className="ml-1.5 inline-flex gap-1 align-middle">{merker}</span>}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{sum}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", prikk)} />
          <span className="tabular-nums">{detalj}</span>
          <PencilIcon className="size-3 opacity-60" aria-hidden />
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mr-1 size-10 self-center text-muted-foreground hover:text-destructive"
        onClick={onSlett}
        aria-label={`Slett ${navn}`}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  )
}

/** Flytter et element i en liste (dra-og-slipp innen samme gruppe). */
export function flyttIListe<T>(liste: readonly T[], fra: number, til: number): T[] {
  const neste = [...liste]
  const [flyttet] = neste.splice(fra, 1)
  if (flyttet === undefined) return neste
  neste.splice(til, 0, flyttet)
  return neste
}
