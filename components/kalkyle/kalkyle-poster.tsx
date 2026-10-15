"use client"

import * as React from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  CelleTall,
  CelleTekst,
  GruppeKort,
  LinjeGruppe,
  LinjeKort,
  LinjeRad,
  LinjeTabell,
  Merke,
  TypeCelle,
  celleValg,
} from "@/components/linjetabell/linjetabell"
import { paslagFor } from "@/lib/kalkyle/beregn"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import { linjeFraLagretJobb, linjeFraPrisliste } from "@/lib/kalkyle/mine-priser"
import type { Enhet, Linje, LinjeType, Post, PostResultat, TimeprisValg } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"
import { LagretJobbVelger } from "./lagret-jobb-velger"
import { ENHETER, LINJE_TYPE, enhetKort, patchForType } from "./linje-type"
import { useMinePriser } from "./mine-priser-kontekst"
import { PrislisteVelger } from "./prisliste-velger"

type KalkylePosterProps = {
  onAapneLinje: (postId: string, linjeId: string) => void
}

/** Timeprisen på en timelinje: kalkylens standard eller en av bedriftens timepriser. */
export function TimeprisVelger({
  linje,
  standardTimesats,
  onVelg,
  label,
  className,
}: {
  linje: Linje
  standardTimesats: number
  onVelg: (timepris: TimeprisValg | null) => void
  label: string
  className?: string
}) {
  const { timepriser } = useMinePriser()
  const valgt = linje.timepris
  // En timepris som er slettet i Mine priser beholdes på linja, med navnet den hadde.
  const valg = valgt && !timepriser.some((t) => t.id === valgt.id) ? [valgt, ...timepriser] : timepriser
  return (
    <select
      aria-label={label}
      value={valgt?.id ?? ""}
      onChange={(e) => onVelg(valg.find((t) => t.id === e.target.value) ?? null)}
      className={className}
    >
      <option value="">Standard · {formatKr(standardTimesats)}/t</option>
      {valg.map((t) => (
        <option key={t.id} value={t.id}>
          {t.navn} · {formatKr(t.timesats)}/t{t.internKost == null ? " (kostpris ikke satt)" : ""}
        </option>
      ))}
    </select>
  )
}

function useSlettMedAngre() {
  const { medAngre } = useKalkyle()
  // «Angre» reverserer bare slettingen, på kalkylen den skjedde i.
  return (melding: string, slett: () => void) => {
    const angre = medAngre(slett)
    toast(melding, { action: { label: "Angre", onClick: angre } })
  }
}

/**
 * Postene i den felles linjetabellen (samme som tilbudsgeneratoren): én tabell
 * med en grå rad per post, redigering rett i cellene og dra-og-slipp av linjer
 * innen og mellom poster (PC), og kompakte kort med redigeringsark (mobil).
 */
export function KalkylePoster({ onAapneLinje }: KalkylePosterProps) {
  const { kalkyle, resultat, leggTilPost, flyttLinje } = useKalkyle()
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
      <LinjeTabell
        onFlytt={(f) => flyttLinje(f.fraGruppe, f.fraIndeks, f.tilGruppe, f.tilIndeks)}
        bunn={
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={nyPost}>
            <PlusIcon aria-hidden />
            Ny post
          </Button>
        }
      >
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
      </LinjeTabell>

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

type LeggTilValg = "timer" | "materiell" | "jobb" | "blank"

const LEGG_TIL: Array<{ valg: LeggTilValg; navn: string }> = [
  { valg: "timer", navn: "Timer" },
  { valg: "materiell", navn: "Materiell" },
  { valg: "jobb", navn: "Fast jobb" },
  { valg: "blank", navn: "Blank" },
]

/**
 * «+ Timer / + Materiell / + Fast jobb / + Blank».
 * - Materiell åpner prislisten (innpris fra prisfilene).
 * - Fast jobb åpner Lagrede jobber.
 * - Timer og Blank legger inn en linje med en gang; Blank kan gjøres om til
 *   hva som helst (også underentreprenør) i Type.
 * På PC dukker linja opp i tabellen; på mobil åpnes arket med en gang.
 */
function LeggTilKnapper({
  post,
  onAapneLinje,
  apneArk,
  className,
}: Pick<PostProps, "post" | "onAapneLinje"> & { apneArk: boolean; className?: string }) {
  const { leggTilLinje, endre, merk } = useKalkyle()
  const [velger, setVelger] = React.useState<"materiell" | "jobb" | null>(null)
  const nyLinje = (type: LinjeType) => {
    const id = leggTilLinje(post.id, type)
    if (id && apneArk) onAapneLinje(post.id, id)
  }
  const klikk = (valg: LeggTilValg) => {
    if (valg === "materiell" || valg === "jobb") setVelger(valg)
    else nyLinje(valg === "timer" ? "arbeid" : "materiell")
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {LEGG_TIL.map((k) => (
        <Button key={k.valg} type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => klikk(k.valg)}>
          <PlusIcon aria-hidden />
          {k.navn}
        </Button>
      ))}
      <PrislisteVelger
        open={velger === "materiell"}
        onOpenChange={(o) => setVelger(o ? "materiell" : null)}
        postNavn={post.navn}
        onVelg={(vare) => merk(endre([{ type: "leggTil", postId: post.id, linje: linjeFraPrisliste(vare) }]))}
        onUtenPrisliste={() => nyLinje("materiell")}
      />
      <LagretJobbVelger
        open={velger === "jobb"}
        onOpenChange={(o) => setVelger(o ? "jobb" : null)}
        postNavn={post.navn}
        onVelg={(jobb) => merk(endre([{ type: "leggTil", postId: post.id, linje: linjeFraLagretJobb(jobb) }]))}
      />
    </div>
  )
}

const TYPE_VALG = (Object.keys(LINJE_TYPE) as LinjeType[]).map((t) => ({ verdi: t, navn: LINJE_TYPE[t].navn }))

function NyeMerker({ linje, ny }: { linje: Linje; ny: boolean }) {
  return (
    <>
      {ny && <Merke tone="ny">Ny</Merke>}
      {linje.anslag && (
        <Merke tone="anslag" title="Prisen er anslått av SmartKI. Sjekk den mot leverandøren.">
          Anslått pris
        </Merke>
      )}
    </>
  )
}

function PostRaderPc({ post, nr, resultat, apen, onBytt, onAapneLinje }: PostProps) {
  const { kalkyle, merket, oppdaterPost, oppdaterLinje, fjernLinje, fjernPost } = useKalkyle()
  const slettMedAngre = useSlettMedAngre()
  if (!kalkyle) return null
  const endre = (linje: Linje, patch: Partial<Omit<Linje, "id">>) => oppdaterLinje(post.id, linje.id, patch)

  return (
    <LinjeGruppe
      id={post.id}
      hva="posten"
      nr={nr}
      navn={post.navn}
      onNavn={(v) => oppdaterPost(post.id, v)}
      antall={post.linjer.length}
      timer={resultat.timer}
      sum={formatKr(resultat.salgEksMva)}
      apen={apen}
      onBytt={onBytt}
      onSlett={() => slettMedAngre(`«${post.navn}» er slettet`, () => fjernPost(post.id))}
      leggTil={<LeggTilKnapper post={post} onAapneLinje={onAapneLinje} apneArk={false} />}
    >
      {post.linjer.map((linje, i) => {
        const r = resultat.linjer[i]
        const harPaslag = linje.type === "materiell" || linje.type === "ue"
        const standardPaslag = linje.type === "materiell" ? kalkyle.paslagMateriell : kalkyle.paslagUe
        const egetPaslag = harPaslag && linje.paslag != null && linje.paslag !== standardPaslag
        const navn = linje.beskrivelse || "linje uten navn"
        return (
          <LinjeRad
            key={linje.id}
            id={linje.id}
            indeks={i}
            navn={navn}
            onAapne={() => onAapneLinje(post.id, linje.id)}
            onSlett={() => slettMedAngre(`«${linje.beskrivelse || "Linjen"}» er slettet`, () => fjernLinje(post.id, linje.id))}
            beskrivelse={
              <div className="flex items-center gap-1.5">
                <CelleTekst
                  label={`Beskrivelse for ${navn}`}
                  value={linje.beskrivelse}
                  onChange={(v) => endre(linje, { beskrivelse: v })}
                  placeholder="Hva er det?"
                  className="min-w-[200px] text-[15px] font-medium"
                />
                <NyeMerker linje={linje} ny={merket.has(linje.id)} />
              </div>
            }
            type={
              <TypeCelle
                label={`Type for ${navn}`}
                value={linje.type}
                valg={TYPE_VALG}
                prikk={LINJE_TYPE[linje.type].prikk}
                onChange={(t) => endre(linje, patchForType(linje, t, r))}
              />
            }
            antall={
              <CelleTall label={`Antall for ${navn}`} value={linje.antall} onChange={(v) => endre(linje, { antall: v })} className="w-16" />
            }
            enhet={
              <select
                aria-label={`Enhet for ${navn}`}
                value={linje.enhet}
                onChange={(e) => endre(linje, { enhet: e.target.value as Enhet })}
                className={celleValg}
              >
                {ENHETER.map((e) => (
                  <option key={e.verdi} value={e.verdi}>
                    {e.kort}
                  </option>
                ))}
              </select>
            }
            pris={
              linje.type === "arbeid" ? (
                <TimeprisVelger
                  linje={linje}
                  standardTimesats={kalkyle.timesats}
                  label={`Timepris for ${navn}`}
                  onVelg={(timepris) => endre(linje, { timepris })}
                  className={cn(celleValg, "text-right")}
                />
              ) : linje.type === "jobb" ? (
                <CelleTall
                  label={`Fastpris for ${navn}`}
                  value={linje.fastpris ?? 0}
                  suffix=" kr"
                  onChange={(v) => endre(linje, { fastpris: v })}
                  className="w-28"
                />
              ) : (
                <CelleTall
                  label={`Innpris for ${navn}`}
                  value={linje.innpris ?? 0}
                  suffix=" kr"
                  onChange={(v) => endre(linje, { innpris: v, anslag: false })}
                  className="w-28"
                />
              )
            }
            paslag={
              harPaslag ? (
                <CelleTall
                  label={`Påslag for ${navn}`}
                  value={paslagFor(linje, kalkyle)}
                  suffix=" %"
                  // Tilbake til kalkylens påslag lagres som «ikke satt», så linja følger det igjen.
                  onChange={(v) => endre(linje, { paslag: v === standardPaslag ? null : v })}
                  className={cn("w-16", egetPaslag && "font-semibold text-foreground")}
                />
              ) : (
                "—"
              )
            }
            sum={formatKr(r.salgEksMva)}
          />
        )
      })}
    </LinjeGruppe>
  )
}

function PostKortMobil({ post, resultat, apen, onBytt, onAapneLinje }: PostProps) {
  const { kalkyle, merket, fjernLinje } = useKalkyle()
  const slettMedAngre = useSlettMedAngre()
  if (!kalkyle) return null

  return (
    <GruppeKort
      navn={post.navn}
      antall={post.linjer.length}
      sum={formatKr(resultat.salgEksMva)}
      apen={apen}
      onBytt={onBytt}
      leggTil={<LeggTilKnapper post={post} onAapneLinje={onAapneLinje} apneArk />}
    >
      {post.linjer.map((linje, i) => {
        const r = resultat.linjer[i]
        const navn = linje.beskrivelse || "Uten navn"
        return (
          <LinjeKort
            key={linje.id}
            navn={navn}
            merker={merket.has(linje.id) || linje.anslag ? <NyeMerker linje={linje} ny={merket.has(linje.id)} /> : undefined}
            prikk={LINJE_TYPE[linje.type].prikk}
            detalj={
              linje.enhet === "rs"
                ? `${LINJE_TYPE[linje.type].navn} · rund sum`
                : `${formatAntall(linje.antall)} ${enhetKort(linje.enhet)} × ${formatKr(r.enhetsprisSalg)}`
            }
            sum={formatKr(r.salgEksMva)}
            onAapne={() => onAapneLinje(post.id, linje.id)}
            onSlett={() => slettMedAngre(`«${linje.beskrivelse || "Linjen"}» er slettet`, () => fjernLinje(post.id, linje.id))}
          />
        )
      })}
    </GruppeKort>
  )
}
