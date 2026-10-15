"use client"

import * as React from "react"
import { ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import type { Enhet, Kalkyle, Linje, LinjeType, Post, PostResultat } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"
import { ENHETER, LINJE_TYPE, enhetKort } from "./linje-type"

type KalkylePosterProps = {
  onAapneLinje: (postId: string, linjeId: string) => void
}

const TYPER = Object.keys(LINJE_TYPE) as LinjeType[]

/** Tall fra et tekstfelt med komma eller punktum. Tomt eller rart blir 0. */
function lesTall(tekst: string): number {
  const n = parseFloat(tekst.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const celle =
  "h-7 w-full min-w-0 rounded bg-transparent px-1.5 text-sm outline-none transition-colors hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-ring/20 pointer-coarse:h-10"

/** Tekst som redigeres rett i cellen, som i tilbudsgeneratoren. */
function CelleTekst({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder?: string
  className?: string
}) {
  return (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(celle, "placeholder:text-muted-foreground/60", className)}
    />
  )
}

/** Tall i cellen: vises formatert, redigeres som rå tekst så «2,» ikke hopper. */
function CelleTall({
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
      value={utkast ?? `${formatAntall(value)}${suffix ?? ""}`}
      onFocus={() => setUtkast(formatAntall(value))}
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

function useSlettMedAngre() {
  const { kalkyle, settKalkyle } = useKalkyle()
  return (melding: string, slett: () => void) => {
    const forrige: Kalkyle | null = kalkyle
    slett()
    toast(melding, { action: { label: "Angre", onClick: () => settKalkyle(forrige) } })
  }
}

/**
 * Postene i samme stil som linjene i tilbudsgeneratoren: én tabell med en grå
 * kategorirad per post og redigering rett i cellene (PC), og kompakte kort med
 * redigeringsark (mobil).
 */
export function KalkylePoster({ onAapneLinje }: KalkylePosterProps) {
  const { kalkyle, resultat, leggTilPost } = useKalkyle()
  const [lukket, setLukket] = React.useState<ReadonlySet<string>>(() => new Set())
  if (!kalkyle || !resultat) return null

  const postene = [...kalkyle.poster].sort((a, b) => a.rekkefolge - b.rekkefolge)
  const bytt = (postId: string) =>
    setLukket((prev) => {
      const neste = new Set(prev)
      if (neste.has(postId)) neste.delete(postId)
      else neste.add(postId)
      return neste
    })
  const nyPost = () => {
    const id = leggTilPost("Ny post")
    if (id) setLukket((prev) => new Set([...prev].filter((p) => p !== id)))
  }
  const res = (postId: string) => resultat.poster.find((p) => p.postId === postId)

  return (
    <>
      <div className="hidden w-full overflow-hidden rounded-lg border bg-background lg:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[34%] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Beskrivelse
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Antall
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhet</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Innpris
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Påslag
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Linjesum
                </TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            {postene.map((post, i) => {
              const r = res(post.id)
              return r ? (
                <PostRaderPc
                  key={post.id}
                  post={post}
                  nr={i + 1}
                  resultat={r}
                  apen={!lukket.has(post.id)}
                  onBytt={() => bytt(post.id)}
                  onAapneLinje={onAapneLinje}
                />
              ) : null
            })}
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="p-1.5">
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={nyPost}>
                    <PlusIcon aria-hidden />
                    Ny post
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-2 lg:hidden">
        {postene.map((post, i) => {
          const r = res(post.id)
          return r ? (
            <PostKortMobil
              key={post.id}
              post={post}
              nr={i + 1}
              resultat={r}
              apen={!lukket.has(post.id)}
              onBytt={() => bytt(post.id)}
              onAapneLinje={onAapneLinje}
            />
          ) : null
        })}
        <Button type="button" variant="outline" className="w-full border-dashed text-muted-foreground" onClick={nyPost}>
          <PlusIcon aria-hidden />
          Ny post
        </Button>
      </div>
    </>
  )
}

type PostProps = {
  post: Post
  nr: number
  resultat: PostResultat
  apen: boolean
  onBytt: () => void
  onAapneLinje: (postId: string, linjeId: string) => void
}

/** På PC dukker den nye linjen opp i tabellen; på mobil åpnes arket med en gang. */
function LeggTilKnapper({
  post,
  onAapneLinje,
  apneArk,
  className,
}: Pick<PostProps, "post" | "onAapneLinje"> & { apneArk: boolean; className?: string }) {
  const { leggTilLinje } = useKalkyle()
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {TYPER.map((t) => (
        <Button
          key={t}
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            const id = leggTilLinje(post.id, t)
            if (id && apneArk) onAapneLinje(post.id, id)
          }}
        >
          <PlusIcon aria-hidden />
          {LINJE_TYPE[t].leggTil}
        </Button>
      ))}
    </div>
  )
}

function PostRaderPc({ post, nr, resultat, apen, onBytt, onAapneLinje }: PostProps) {
  const { kalkyle, merket, oppdaterPost, oppdaterLinje, fjernLinje, fjernPost } = useKalkyle()
  const slettMedAngre = useSlettMedAngre()
  if (!kalkyle) return null
  const endre = (linje: Linje, patch: Partial<Omit<Linje, "id">>) => oppdaterLinje(post.id, linje.id, patch)

  return (
    <TableBody>
      <TableRow className="bg-muted/50 hover:bg-muted/70">
        <TableCell colSpan={8} className="py-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded hover:bg-muted"
              onClick={onBytt}
              aria-expanded={apen}
              aria-label={apen ? `Skjul ${post.navn}` : `Vis ${post.navn}`}
            >
              <ChevronDownIcon
                className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", !apen && "-rotate-90")}
              />
            </button>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">{nr}</span>
            <CelleTekst
              label="Navn på posten"
              value={post.navn}
              onChange={(v) => oppdaterPost(post.id, v)}
              placeholder="Navn på posten"
              className="w-auto max-w-72 flex-none text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            />
            <Badge variant="outline" className="h-4 rounded-sm px-1.5 text-[10px] font-normal">
              {post.linjer.length}
            </Badge>
            {resultat.timer > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">{formatAntall(resultat.timer)} t</span>
            )}
            <span className="ml-auto text-sm font-semibold tabular-nums">{formatKr(resultat.salgEksMva)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              aria-label={`Slett posten ${post.navn}`}
              onClick={() => slettMedAngre(`«${post.navn}» er slettet`, () => fjernPost(post.id))}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {apen &&
        post.linjer.map((linje, i) => {
          const r = resultat.linjer[i]
          const erArbeid = linje.type === "arbeid"
          const paslag = linje.type === "materiell" ? kalkyle.paslagMateriell : kalkyle.paslagUe
          const navn = linje.beskrivelse || "linje uten navn"
          return (
            <TableRow key={linje.id} className="group/row">
              <TableCell className="p-1.5 pl-3">
                <div className="flex items-center gap-1.5">
                  <CelleTekst
                    label={`Beskrivelse for ${navn}`}
                    value={linje.beskrivelse}
                    onChange={(v) => endre(linje, { beskrivelse: v })}
                    placeholder="Hva er det?"
                    className="font-medium"
                  />
                  {merket.has(linje.id) && (
                    <span className="shrink-0 rounded-sm border border-[#d7e8bf] bg-[color:var(--surface-success)] px-1.5 text-[10px] font-semibold text-[#4d7219]">
                      Ny
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="p-1.5">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", LINJE_TYPE[linje.type].prikk)} />
                  <select
                    aria-label={`Type for ${navn}`}
                    value={linje.type}
                    onChange={(e) => {
                      const type = e.target.value as LinjeType
                      endre(linje, type === "arbeid" ? { type, enhet: "t" } : { type, innpris: linje.innpris ?? 0 })
                    }}
                    className={cn(celle, "w-auto pr-1 text-muted-foreground")}
                  >
                    {TYPER.map((t) => (
                      <option key={t} value={t}>
                        {LINJE_TYPE[t].navn}
                      </option>
                    ))}
                  </select>
                </div>
              </TableCell>
              <TableCell className="p-1.5">
                <CelleTall label={`Antall for ${navn}`} value={linje.antall} onChange={(v) => endre(linje, { antall: v })} className="w-16" />
              </TableCell>
              <TableCell className="p-1.5">
                <select
                  aria-label={`Enhet for ${navn}`}
                  value={linje.enhet}
                  onChange={(e) => endre(linje, { enhet: e.target.value as Enhet })}
                  className={cn(celle, "w-auto text-muted-foreground")}
                >
                  {ENHETER.map((e) => (
                    <option key={e.verdi} value={e.verdi}>
                      {e.kort}
                    </option>
                  ))}
                </select>
              </TableCell>
              <TableCell className="p-1.5 text-right">
                {erArbeid ? (
                  <span className="px-1.5 text-sm tabular-nums text-muted-foreground">{formatKr(kalkyle.timesats)}/t</span>
                ) : (
                  <CelleTall
                    label={`Innpris for ${navn}`}
                    value={linje.innpris ?? 0}
                    suffix=" kr"
                    onChange={(v) => endre(linje, { innpris: v })}
                    className="ml-auto w-28"
                  />
                )}
              </TableCell>
              <TableCell className="p-1.5 text-right text-sm tabular-nums text-muted-foreground">
                {erArbeid ? "—" : `${paslag} %`}
              </TableCell>
              <TableCell className="p-1.5 text-right text-sm font-semibold tabular-nums">{formatKr(r.salgEksMva)}</TableCell>
              <TableCell className="p-1.5 pr-2">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-transparent group-hover/row:text-muted-foreground focus-visible:text-muted-foreground hover:!text-foreground"
                    aria-label={`Åpne ${navn}`}
                    onClick={() => onAapneLinje(post.id, linje.id)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-transparent group-hover/row:text-muted-foreground focus-visible:text-muted-foreground hover:!text-destructive"
                    aria-label={`Slett ${navn}`}
                    onClick={() => slettMedAngre(`«${linje.beskrivelse || "Linjen"}» er slettet`, () => fjernLinje(post.id, linje.id))}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}

      {apen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="p-1 pl-2">
            {post.linjer.length === 0 && (
              <p className="px-1.5 pt-1 text-xs text-muted-foreground">Ingen linjer i denne posten ennå.</p>
            )}
            <LeggTilKnapper post={post} onAapneLinje={onAapneLinje} apneArk={false} />
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  )
}

function PostKortMobil({ post, resultat, apen, onBytt, onAapneLinje }: PostProps) {
  const { kalkyle, merket, fjernLinje } = useKalkyle()
  const slettMedAngre = useSlettMedAngre()
  if (!kalkyle) return null

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 bg-muted/50 px-3 py-2.5 text-left"
        onClick={onBytt}
        aria-expanded={apen}
        aria-label={apen ? `Skjul ${post.navn}` : `Vis ${post.navn}`}
      >
        <ChevronDownIcon
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", !apen && "-rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {post.navn || "Uten navn"}
        </span>
        <Badge variant="outline" className="h-4 rounded-sm px-1.5 text-[10px] font-normal">
          {post.linjer.length}
        </Badge>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatKr(resultat.salgEksMva)}</span>
      </button>

      {apen && (
        <>
          {post.linjer.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Ingen linjer i denne posten ennå.</p>
          ) : (
            <div className="divide-y">
              {post.linjer.map((linje, i) => {
                const r = resultat.linjer[i]
                const navn = linje.beskrivelse || "Uten navn"
                const pris =
                  linje.enhet === "rs"
                    ? `${LINJE_TYPE[linje.type].navn} · rund sum`
                    : `${formatAntall(linje.antall)} ${enhetKort(linje.enhet)} × ${formatKr(r.enhetsprisSalg)}`
                return (
                  <div key={linje.id} className="flex items-stretch">
                    <button
                      type="button"
                      className="min-w-0 flex-1 py-3 pr-1 pl-3 text-left transition-colors active:bg-muted/60"
                      onClick={() => onAapneLinje(post.id, linje.id)}
                      aria-label={`Rediger ${navn}`}
                    >
                      <span className="flex items-start gap-3">
                        <span className="min-w-0 flex-1 text-sm leading-snug font-medium">
                          {navn}
                          {merket.has(linje.id) && (
                            <span className="ml-1.5 rounded-sm border border-[#d7e8bf] bg-[color:var(--surface-success)] px-1.5 text-[10px] font-semibold text-[#4d7219]">
                              Ny
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatKr(r.salgEksMva)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span aria-hidden className={cn("size-1.5 rounded-full", LINJE_TYPE[linje.type].prikk)} />
                        <span className="tabular-nums">{pris}</span>
                        <PencilIcon className="size-3 opacity-60" aria-hidden />
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mr-1 size-10 self-center text-muted-foreground hover:text-destructive"
                      onClick={() => slettMedAngre(`«${linje.beskrivelse || "Linjen"}» er slettet`, () => fjernLinje(post.id, linje.id))}
                      aria-label={`Slett ${navn}`}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          <LeggTilKnapper post={post} onAapneLinje={onAapneLinje} apneArk className="border-t px-1.5 py-1" />
        </>
      )}
    </div>
  )
}
