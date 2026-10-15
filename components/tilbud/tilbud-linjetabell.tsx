"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"
import { toast } from "sonner"

import { LINJE_TYPE } from "@/components/kalkyle/linje-type"
import { ArkFelt, ArkTall, ArkValg, LinjeArkSkall, arkInput } from "@/components/linjetabell/linje-ark-skall"
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
  formatTall,
  lesTall,
} from "@/components/linjetabell/linjetabell"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { isHourUnit } from "@/lib/job-costing/calc"
import { sanitizeLaborSnapshot } from "@/lib/tilbud/labor"
import {
  INCOME_ACCOUNT_CATEGORY_OPTIONS,
  effectiveIncomeAccountCategory,
  type IncomeAccountCategory,
} from "@/lib/tilbud/income-accounts"
import {
  buildGroups,
  moveItemBetweenGroups,
  normalizeGroupName,
  reorderItemsInGroup,
  resolveNobb,
} from "@/lib/tilbud/line-item-groups"
import { formatDocumentUnit } from "@/lib/tilbud/offer-document"
import {
  calculateLineItemTotal,
  calculateLineItemUnitPriceWithMarkupBeforeDiscount,
  formatNok,
  type OfferLineItem,
} from "@/lib/tilbud/types"
import { AddOfferLineItemMenu } from "./add-offer-line-item-menu"
import {
  LaborCostHint,
  LineItemInfoButton,
  describeLineItemPrice,
  type NewOfferItemsTableHandle,
  type NewOfferItemsTableProps,
} from "./new-offer-items-table"

export type TilbudLinjetabellProps = NewOfferItemsTableProps & {
  /** Gir «+ Timer / + Materiell / + Fast jobb / + Blank» under hver kategori. */
  onAddItems?: (items: OfferLineItem[]) => void
  companyName?: string | null
  defaultMarkupPercent?: number
  /** Uten egen ramme, når tabellen står inne i et kort som har det (tilbudssiden). */
  utenRamme?: boolean
}

type TilbudLinjeType = "timer" | "materiell" | "jobb"

/** Typen på en tilbudslinje, utledet av enheten og hvor linja kom fra. */
export function tilbudLinjeType(item: OfferLineItem): TilbudLinjeType {
  if (isHourUnit(item.unit)) return "timer"
  if (item.priceSource === "lagret-jobb" || (item.plannedHours ?? 0) > 0) return "jobb"
  return "materiell"
}

const TYPE: Record<TilbudLinjeType, { navn: string; prikk: string }> = {
  timer: { navn: LINJE_TYPE.arbeid.navn, prikk: LINJE_TYPE.arbeid.prikk },
  materiell: { navn: LINJE_TYPE.materiell.navn, prikk: LINJE_TYPE.materiell.prikk },
  jobb: { navn: LINJE_TYPE.jobb.navn, prikk: LINJE_TYPE.jobb.prikk },
}

/** Fast jobb kan bare komme fra Lagrede jobber, så den tilbys bare på slike linjer. */
function typeValg(gjeldende: TilbudLinjeType) {
  const typer: TilbudLinjeType[] = gjeldende === "jobb" ? ["timer", "materiell", "jobb"] : ["timer", "materiell"]
  return typer.map((t) => ({ verdi: t, navn: TYPE[t].navn, prikk: TYPE[t].prikk }))
}

/** Patch når typen byttes: timer ↔ materiell styres av enheten. */
function patchForTilbudType(item: OfferLineItem, type: TilbudLinjeType): Partial<OfferLineItem> {
  if (type === "timer") return { unit: "timer", plannedHours: undefined, priceSource: item.priceSource === "lagret-jobb" ? undefined : item.priceSource }
  if (type === "materiell") {
    return {
      unit: isHourUnit(item.unit) ? "stk" : item.unit,
      plannedHours: undefined,
      priceSource: item.priceSource === "lagret-jobb" ? undefined : item.priceSource,
    }
  }
  return {}
}

/**
 * Tilbudsgeneratorens linjer i den felles linjetabellen (samme som kalkylen):
 * kategorier som grå rader, redigering i cellene, dra-og-slipp og et kompakt
 * ark for resten (leverandør, rabatt, inntektskonto). Samme props og handle som
 * NewOfferItemsTable, så den kan byttes inn bak KALKYLE_ENABLED.
 */
export const TilbudLinjetabell = React.forwardRef<NewOfferItemsTableHandle, TilbudLinjetabellProps>(function TilbudLinjetabell(
  { items, onItemsChange, supplierSuggestions, onCategoryChange, onAddItems, companyName, defaultMarkupPercent, utenRamme },
  ref
) {
  const confirm = useConfirm()
  const [lukket, setLukket] = React.useState<ReadonlySet<string>>(() => new Set())
  const [tommeGrupper, setTommeGrupper] = React.useState<string[]>([])
  // `ny`: en ny rad skal få navnet sitt skrevet inn med en gang; en eksisterende åpnes uten tastatur.
  const [apnet, setApnet] = React.useState<{ id: string; ny: boolean } | null>(null)
  const apenId = apnet?.id ?? null

  const grupper = React.useMemo(() => buildGroups(items), [items])
  const rekkefolge = React.useMemo(() => {
    const finnes = Object.keys(grupper)
    return [...finnes, ...tommeGrupper.filter((g) => !finnes.includes(g))]
  }, [grupper, tommeGrupper])

  // Siste verdier for handle-metodene og «Angre», uten å vente på ny render.
  const sist = React.useRef({ items, grupper, rekkefolge })
  React.useEffect(() => {
    sist.current = { items, grupper, rekkefolge }
  })

  const oppdater = React.useCallback(
    (id: string, patch: Partial<OfferLineItem>) => {
      onItemsChange(
        items.map((item) => {
          if (item.id !== id) return item
          const neste = { ...item, ...patch }
          // Retter håndverkeren prisen selv, er den ikke lenger et anslag.
          if (patch.unitPriceNok !== undefined && patch.unitPriceNok !== item.unitPriceNok && item.priceSource === "anslag") {
            neste.priceSource = undefined
          }
          // Byttes enheten bort fra timer, er kostprisen fra timeprisen irrelevant.
          return sanitizeLaborSnapshot(neste)
        })
      )
    },
    [items, onItemsChange]
  )

  const slett = (fjernet: OfferLineItem) => {
    const indeks = items.findIndex((i) => i.id === fjernet.id)
    onItemsChange(items.filter((i) => i.id !== fjernet.id))
    if (apenId === fjernet.id) setApnet(null)
    toast(`«${fjernet.title || "Linjen"}» er slettet`, {
      action: {
        label: "Angre",
        onClick: () => {
          const naa = sist.current.items
          if (naa.some((i) => i.id === fjernet.id)) return
          const neste = [...naa]
          neste.splice(Math.min(Math.max(indeks, 0), neste.length), 0, fjernet)
          onItemsChange(neste)
        },
      },
    })
  }

  const bytt = (gruppe: string) =>
    setLukket((prev) => {
      const neste = new Set(prev)
      if (neste.has(gruppe)) neste.delete(gruppe)
      else neste.add(gruppe)
      return neste
    })

  const endreNavn = (gammelt: string, nyttRaatt: string) => {
    const nytt = normalizeGroupName(nyttRaatt)
    if (nytt === gammelt) return
    onItemsChange(items.map((i) => (normalizeGroupName(i.subproject) === gammelt ? { ...i, subproject: nytt } : i)))
    setTommeGrupper((prev) => prev.map((g) => (g === gammelt ? nytt : g)))
    setLukket((prev) => {
      if (!prev.has(gammelt)) return prev
      const neste = new Set(prev)
      neste.delete(gammelt)
      neste.add(nytt)
      return neste
    })
    onCategoryChange?.(gammelt, nytt)
  }

  const fjernKategori = React.useCallback(
    async (gruppe: string) => {
      const linjer = sist.current.grupper[gruppe] || []
      if (linjer.length > 0) {
        const ok = await confirm({
          title: "Fjerne kategori?",
          description: `Kategorien «${gruppe}» inneholder ${linjer.length} linje${linjer.length === 1 ? "" : "r"}. Kategorien og alle linjene i den fjernes fra tilbudet.`,
          confirmText: "Fjern kategori",
          cancelText: "Avbryt",
          variant: "destructive",
        })
        if (!ok) return
      }
      onItemsChange(sist.current.items.filter((i) => normalizeGroupName(i.subproject) !== gruppe))
      setTommeGrupper((prev) => prev.filter((g) => g !== gruppe))
      onCategoryChange?.(gruppe, null)
    },
    [confirm, onItemsChange, onCategoryChange]
  )

  React.useImperativeHandle(
    ref,
    (): NewOfferItemsTableHandle => ({
      addCategory: () => {
        const finnes = sist.current.rekkefolge
        let n = finnes.length + 1
        while (finnes.includes(`Kategori ${n}`)) n += 1
        const navn = `Kategori ${n}`
        setTommeGrupper((prev) => [...prev, navn])
        return navn
      },
      removeCategory: (gruppe) => void fjernKategori(gruppe),
      getCategories: () => sist.current.rekkefolge,
      editItem: (item) => {
        // Med tabellen (PC) redigeres en ny rad rett i cellene; arket hører til kortene.
        if (!window.matchMedia("(max-width: 1023px)").matches) return
        setApnet({ id: item.id, ny: true })
      },
    }),
    [fjernKategori]
  )

  const flytt = (f: { fraGruppe: string; fraIndeks: number; tilGruppe: string; tilIndeks: number }) => {
    onItemsChange(
      f.fraGruppe === f.tilGruppe
        ? reorderItemsInGroup(items, f.fraGruppe, f.fraIndeks, f.tilIndeks)
        : moveItemBetweenGroups(items, f.fraGruppe, f.tilGruppe, f.fraIndeks, f.tilIndeks)
    )
    setTommeGrupper((prev) => prev.filter((g) => g !== f.tilGruppe))
  }

  const leggTil = (gruppe: string) =>
    onAddItems ? (
      <AddOfferLineItemMenu
        variant="knapper"
        onAddItems={onAddItems}
        defaultSubproject={gruppe}
        defaultMarkupPercent={defaultMarkupPercent}
        companyName={companyName}
        onBlankItemAdded={(item) => {
          if (!window.matchMedia("(max-width: 1023px)").matches) return
          setApnet({ id: item.id, ny: true })
        }}
      />
    ) : undefined

  const gruppeSum = (gruppe: string) => formatNok((grupper[gruppe] || []).reduce((s, i) => s + calculateLineItemTotal(i), 0))
  const apen = apenId ? items.find((i) => i.id === apenId) ?? null : null

  if (rekkefolge.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        Ingen linjer ennå. Bruk «Legg til» for å hente fra prislisten, legge inn arbeidstimer eller en blank rad.
      </div>
    )
  }

  return (
    <>
      <LinjeTabell onFlytt={flytt} className={utenRamme ? "rounded-none border-0" : undefined}>
        {rekkefolge.map((gruppe) => {
          const linjer = grupper[gruppe] || []
          return (
            <LinjeGruppe
              key={gruppe}
              id={gruppe}
              hva="kategorien"
              lagreNavnVedBlur
              navn={gruppe}
              onNavn={(v) => endreNavn(gruppe, v)}
              antall={linjer.length}
              sum={gruppeSum(gruppe)}
              apen={!lukket.has(gruppe)}
              onBytt={() => bytt(gruppe)}
              onSlett={() => void fjernKategori(gruppe)}
              leggTil={leggTil(gruppe)}
            >
              {linjer.map((item, indeks) => (
                <TilbudRad
                  key={item.id}
                  item={item}
                  indeks={indeks}
                  onEndre={(patch) => oppdater(item.id, patch)}
                  onAapne={() => setApnet({ id: item.id, ny: false })}
                  onSlett={() => slett(item)}
                />
              ))}
            </LinjeGruppe>
          )
        })}
      </LinjeTabell>

      <div className="space-y-2 p-2 lg:hidden">
        {rekkefolge.map((gruppe) => {
          const linjer = grupper[gruppe] || []
          return (
            <GruppeKort
              key={gruppe}
              navn={gruppe}
              antall={linjer.length}
              sum={gruppeSum(gruppe)}
              apen={!lukket.has(gruppe)}
              onBytt={() => bytt(gruppe)}
              leggTil={leggTil(gruppe)}
            >
              {linjer.map((item) => (
                <LinjeKort
                  key={item.id}
                  navn={item.title || "Uten navn"}
                  merker={item.priceSource === "anslag" ? <Merke tone="anslag">Anslått pris</Merke> : undefined}
                  prikk={TYPE[tilbudLinjeType(item)].prikk}
                  detalj={describeLineItemPrice(item)}
                  sum={formatNok(calculateLineItemTotal(item))}
                  onAapne={() => setApnet({ id: item.id, ny: false })}
                  onSlett={() => slett(item)}
                />
              ))}
            </GruppeKort>
          )
        })}
      </div>

      {apen && (
        <TilbudLinjeArk
          item={apen}
          leverandorer={supplierSuggestions}
          fokusNavn={apnet?.ny ?? false}
          onEndre={(patch) => oppdater(apen.id, patch)}
          onLukk={() => setApnet(null)}
          onSlett={() => slett(apen)}
        />
      )}
    </>
  )
})

TilbudLinjetabell.displayName = "TilbudLinjetabell"

function TilbudRad({
  item,
  indeks,
  onEndre,
  onAapne,
  onSlett,
}: {
  item: OfferLineItem
  indeks: number
  onEndre: (patch: Partial<OfferLineItem>) => void
  onAapne: () => void
  onSlett: () => void
}) {
  const navn = item.title || "linje uten navn"
  const type = tilbudLinjeType(item)
  const nobb = resolveNobb(item)
  return (
    <LinjeRad
      id={item.id}
      indeks={indeks}
      navn={navn}
      onAapne={onAapne}
      onSlett={onSlett}
      beskrivelse={
        <div className="flex items-center gap-1.5">
          <CelleTekst
            label={`Beskrivelse for ${navn}`}
            value={item.title}
            onChange={(v) => onEndre({ title: v })}
            placeholder="Hva er det?"
            className="min-w-[200px] text-[15px] font-medium"
          />
          {item.priceSource === "anslag" && (
            <Merke tone="anslag" title="Prisen er et anslag, ikke funnet i prisfilene. Sjekk den før du sender tilbudet.">
              Anslått pris
            </Merke>
          )}
          {item.supplier && <Merke tone="noytral">{item.supplier}</Merke>}
          <LineItemInfoButton item={item} />
          {nobb && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Åpne NOBB ${nobb}`}
              title={`Åpne NOBB ${nobb}`}
              onClick={() => window.open(`https://nobb.no/item/${encodeURIComponent(nobb)}`, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
      }
      type={
        <TypeCelle
          label={`Type for ${navn}`}
          value={type}
          valg={typeValg(type)}
          prikk={TYPE[type].prikk}
          onChange={(t) => onEndre(patchForTilbudType(item, t))}
        />
      }
      antall={<CelleTall label={`Antall for ${navn}`} value={item.quantity} onChange={(v) => onEndre({ quantity: v })} className="w-16" />}
      enhet={
        <CelleTekst
          label={`Enhet for ${navn}`}
          value={item.unit}
          onChange={(v) => onEndre({ unit: v })}
          placeholder="stk"
          size={Math.max(3, item.unit.length + 1)}
          className="w-auto text-muted-foreground"
        />
      }
      pris={
        <CelleTall
          label={`${type === "timer" ? "Timepris" : "Innpris"} for ${navn}`}
          value={item.unitPriceNok}
          suffix=" kr"
          onChange={(v) => onEndre({ unitPriceNok: v })}
          className="w-28"
        />
      }
      paslag={
        <CelleTall
          label={`Påslag for ${navn}`}
          value={item.markupPercent}
          suffix=" %"
          onChange={(v) => onEndre({ markupPercent: v })}
          className="w-16"
        />
      }
      sum={
        <span className="flex flex-col items-end leading-tight">
          {formatNok(calculateLineItemTotal(item))}
          {item.discountPercent > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">−{formatTall(item.discountPercent)} % rabatt</span>
          )}
        </span>
      }
    />
  )
}

/** Kompakt redigeringsark for én tilbudslinje, med feltene som ikke står i tabellen. */
function TilbudLinjeArk({
  item,
  leverandorer,
  fokusNavn,
  onEndre,
  onLukk,
  onSlett,
}: {
  item: OfferLineItem
  leverandorer: string[]
  fokusNavn: boolean
  onEndre: (patch: Partial<OfferLineItem>) => void
  onLukk: () => void
  onSlett: () => void
}) {
  const type = tilbudLinjeType(item)
  // Tallfeltene holder det brukeren skriver («2,»); tallet lagres fortløpende.
  const [tekst, setTekst] = React.useState(() => ({
    antall: formatTall(item.quantity),
    pris: formatTall(item.unitPriceNok),
    paslag: formatTall(item.markupPercent),
    rabatt: formatTall(item.discountPercent),
  }))
  const tall = (felt: keyof typeof tekst, patch: (v: number) => Partial<OfferLineItem>) => (t: string) => {
    setTekst((prev) => ({ ...prev, [felt]: t }))
    onEndre(patch(lesTall(t)))
  }
  const per = isHourUnit(item.unit) ? "time" : formatDocumentUnit(item.unit || "stk")

  return (
    <LinjeArkSkall
      open
      onLukk={onLukk}
      tittel={TYPE[type].navn}
      prikk={TYPE[type].prikk}
      undertittel={normalizeGroupName(item.subproject)}
      sum={{
        kunden: formatNok(calculateLineItemTotal(item)),
        merknad: `Eks. mva · ${formatNok(calculateLineItemUnitPriceWithMarkupBeforeDiscount(item))} per ${per} før rabatt`,
      }}
      onSlett={onSlett}
      onOpenAutoFocus={(e) => {
        if (fokusNavn) return
        // Fokus på arket, ikke i et felt: tastaturet på mobil blir nede.
        e.preventDefault()
        ;(e.currentTarget as HTMLElement | null)?.focus()
      }}
    >
      <ArkValg label="Type" valg={typeValg(type)} value={type} onChange={(t) => onEndre(patchForTilbudType(item, t))} />

      <ArkFelt label="Beskrivelse" htmlFor="tilbudslinje-navn">
        <input
          id="tilbudslinje-navn"
          value={item.title}
          onChange={(e) => onEndre({ title: e.target.value })}
          placeholder="F.eks. Flislegging vegg"
          className={arkInput}
        />
      </ArkFelt>

      <div className="grid grid-cols-2 gap-2.5">
        <ArkFelt label="Antall" htmlFor="tilbudslinje-antall">
          <ArkTall id="tilbudslinje-antall" value={tekst.antall} onChange={tall("antall", (v) => ({ quantity: v }))} />
        </ArkFelt>
        <ArkFelt label="Enhet" htmlFor="tilbudslinje-enhet">
          <input
            id="tilbudslinje-enhet"
            list="tilbudslinje-enheter"
            value={item.unit}
            onChange={(e) => onEndre({ unit: e.target.value })}
            placeholder="stk"
            className={arkInput}
          />
          <datalist id="tilbudslinje-enheter">
            {["timer", "stk", "m2", "lm", "sett", "rull", "pall"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </ArkFelt>
        <ArkFelt
          label={type === "timer" ? "Timepris" : `Innpris per ${per}`}
          htmlFor="tilbudslinje-pris"
          hjelp={type === "timer" ? <LaborCostHint item={item} /> : undefined}
        >
          <ArkTall id="tilbudslinje-pris" value={tekst.pris} suffix="kr" onChange={tall("pris", (v) => ({ unitPriceNok: v }))} />
        </ArkFelt>
        <ArkFelt label="Påslag" htmlFor="tilbudslinje-paslag">
          <ArkTall id="tilbudslinje-paslag" value={tekst.paslag} suffix="%" onChange={tall("paslag", (v) => ({ markupPercent: v }))} />
        </ArkFelt>
        <ArkFelt label="Rabatt til kunden" htmlFor="tilbudslinje-rabatt">
          <ArkTall
            id="tilbudslinje-rabatt"
            value={tekst.rabatt}
            suffix="%"
            onChange={tall("rabatt", (v) => ({ discountPercent: Math.min(v, 100) }))}
          />
        </ArkFelt>
        <ArkFelt label="Leverandør" htmlFor="tilbudslinje-leverandor">
          <input
            id="tilbudslinje-leverandor"
            list="tilbudslinje-leverandorer"
            value={item.supplier ?? ""}
            onChange={(e) => onEndre({ supplier: e.target.value })}
            placeholder="Ingen"
            className={arkInput}
          />
          <datalist id="tilbudslinje-leverandorer">
            {leverandorer.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </ArkFelt>
      </div>

      <ArkFelt
        label="Inntektskonto (regnskap)"
        htmlFor="tilbudslinje-konto"
        hjelp={item.incomeAccountCategory ? "Valgt manuelt." : "Foreslått ut fra enhet og leverandør."}
      >
        <select
          id="tilbudslinje-konto"
          value={effectiveIncomeAccountCategory(item)}
          onChange={(e) => onEndre({ incomeAccountCategory: e.target.value as IncomeAccountCategory })}
          className={arkInput}
        >
          {INCOME_ACCOUNT_CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </ArkFelt>
    </LinjeArkSkall>
  )
}
