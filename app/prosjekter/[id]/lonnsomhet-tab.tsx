"use client"

/**
 * Lønnsomheten på prosjektet: resultat og dekningsgrad, kalkyle mot faktisk.
 *
 * Poenget med fanen er ikke å vise flest mulig tall, men å svare på ett
 * spørsmål håndverkeren sjelden får svar på før jobben er ferdig: tjener jeg
 * penger på dette, og ligger jeg an som jeg regnet med? Derfor står
 * dekningsbidrag og dekningsgrad øverst, og avviket mot kalkylen rett under.
 */

import * as React from "react"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { InfoHint } from "@/components/ui/info-hint"
import { formatNok } from "@/lib/tilbud/types"
import { formatHours } from "@/lib/time-tracking"
import { reportClientError } from "@/lib/errors/client"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import type { SearchMaterial } from "@/lib/tilbud/company-price-utils"
import { cn } from "@/lib/utils"
import { formatMarginPct, formatSignedValue } from "@/lib/job-costing/format"

import {
  addMaterialCostAction,
  deleteMaterialCostAction,
  getProjectProfitabilityAction,
  saveProjectBudgetAction,
} from "./job-costing-actions"

const PLANNED_MISSING_TEXT: Record<
  NonNullable<ProjectProfitability["plannedMissingReason"]>,
  string
> = {
  no_offers: "Ingen kalkyle å sammenligne med før et tilbud er akseptert på prosjektet.",
  no_lines:
    "Ingen kalkyle å sammenligne med — de aksepterte tilbudene har ingen linjer med mengde og pris.",
  fixed_price:
    "Tilbudet er priset som fastpris. Fastprislinjer sier hva kunden betaler, ikke hva jobben koster, så det finnes ingen kalkyle å måle mot. Den faktiske kolonnen stemmer likevel.",
}

/**
 * Overskrift på et kort, med forklaringen bak en (i) i stedet for en grå
 * hjelpetekst under. Holder kortene rene uten å ta bort forklaringen.
 */
function SectionHeader({
  title,
  info,
  infoTitle,
  right,
}: {
  title: string
  info: React.ReactNode
  infoTitle: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-1">
        <p className="text-sm font-medium">{title}</p>
        <InfoHint title={infoTitle}>{info}</InfoHint>
      </div>
      {right}
    </div>
  )
}

/** Feltetikett med (i). Ikonet ligger utenfor <label> så klikk ikke treffer feltet. */
function FieldLabel({
  htmlFor,
  label,
  info,
  infoTitle,
}: {
  htmlFor: string
  label: string
  info: React.ReactNode
  infoTitle: string
}) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      <InfoHint title={infoTitle}>{info}</InfoHint>
    </div>
  )
}

function formatDecimal(value: number) {
  return value.toFixed(1).replace(".", ",")
}

/**
 * «12. sep», men «12. sep 2027» når datoen ikke er i år.
 *
 * Uten årstallet leses en dato langt fram i tid som om den var i fortiden —
 * «ferdige 19. juni» i august er ren forvirring.
 */
function formatShortDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString("no-NO", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

/** «1 akseptert tilbud + 2 tillegg» — tillegg nevnes bare når de finnes. */
function revenueSourceLabel(data: ProjectProfitability) {
  const offers = `${data.acceptedOfferCount} akseptert${data.acceptedOfferCount === 1 ? "" : "e"} tilbud`
  if (data.acceptedChangeOrderCount === 0) return offers
  const extras = `${data.acceptedChangeOrderCount} godkjent${
    data.acceptedChangeOrderCount === 1 ? "" : "e"
  } tilleggsarbeid`
  return `${offers} + ${extras}`
}

function Kpi({
  label,
  value,
  hint,
  tone,
  info,
}: {
  label: string
  value: string
  /** Tall som utdyper verdien (fordeling, sammenligning) — blir stående synlig. */
  hint?: string
  tone?: "good" | "bad"
  /** Hva tallet betyr og hvordan det er regnet ut — ligger bak (i). */
  info?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        {info ? <InfoHint title={label}>{info}</InfoHint> : null}
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** En rad i «kalkyle mot faktisk». Avviket regnes alltid som faktisk − kalkyle. */
function ComparisonRow({
  label,
  planned,
  actual,
  format,
  /** Høyere enn kalkylen er bra for inntekt/resultat, dårlig for kostnader. */
  higherIsBetter,
  strong,
  showPlanned,
}: {
  label: string
  planned: number | null
  actual: number
  format: (value: number) => string
  higherIsBetter: boolean
  strong?: boolean
  /** Uten kalkyle vises bare det faktiske — en kolonne med bare «—» er støy. */
  showPlanned: boolean
}) {
  const diff = planned === null ? null : Math.round((actual - planned) * 100) / 100
  const diffTone =
    diff === null || Math.abs(diff) < 0.5
      ? "text-muted-foreground"
      : (diff > 0) === higherIsBetter
        ? "text-emerald-600"
        : "text-destructive"

  return (
    <tr className={cn("border-t", strong && "font-medium")}>
      <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
        {strong ? <span className="font-medium text-foreground">{label}</span> : label}
      </th>
      {showPlanned && (
        <td className="py-2 pr-3 text-right tabular-nums">
          {planned === null ? "—" : format(planned)}
        </td>
      )}
      <td className="py-2 pr-3 text-right tabular-nums">{format(actual)}</td>
      {showPlanned && (
        <td className={cn("py-2 text-right tabular-nums", diffTone)}>
          {diff === null ? "—" : formatSignedValue(diff, format)}
        </td>
      )}
    </tr>
  )
}

/**
 * Målet jobben skal styres mot, og hvor langt den er kommet.
 *
 * Fastprisjobber har ingen kalkyle i tilbudet — tilbudet sier hva kunden
 * betaler, ikke hva jobben skal koste. Uten disse feltene har flertallet av
 * brukerne ingenting å måle det faktiske forbruket mot.
 */
function BudgetForm({
  projectId,
  data,
  onSaved,
}: {
  projectId: string
  data: ProjectProfitability
  onSaved: () => void
}) {
  const [hours, setHours] = useState(data.budgetInput.hours?.toString() ?? "")
  const [material, setMaterial] = useState(data.budgetInput.materialNok?.toString() ?? "")
  const [saving, setSaving] = useState(false)

  // Serveren er fasit: etter lagring og ny henting skal feltene vise det som
  // faktisk ble lagret, ikke det brukeren rakk å skrive.
  useEffect(() => {
    setHours(data.budgetInput.hours?.toString() ?? "")
    setMaterial(data.budgetInput.materialNok?.toString() ?? "")
  }, [data.budgetInput.hours, data.budgetInput.materialNok])

  function parseField(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed.replace(/\s/g, "").replace(",", "."))
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  async function handleSave() {
    const budgetedHours = parseField(hours)
    const budgetedMaterialNok = parseField(material)

    if ([budgetedHours, budgetedMaterialNok].some((v) => Number.isNaN(v))) {
      toast.error("Skriv inn tall, eller la feltet stå tomt")
      return
    }

    setSaving(true)
    try {
      await saveProjectBudgetAction({
        projectId,
        budgetedHours,
        budgetedMaterialNok,
      })
      toast.success("Budsjettet er lagret")
      onSaved()
    } catch (e) {
      reportClientError(e, { context: { action: "lagre prosjektbudsjett", projectId } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  const fromOffer = data.plannedSource === "tilbud"

  // Gjenstående regnes live mens man skriver, så budsjettet kan justeres mot
  // det som faktisk er brukt uten å lagre først.
  const parsedHours = parseField(hours)
  const parsedMaterial = parseField(material)
  const remainingHours =
    parsedHours !== null && !Number.isNaN(parsedHours)
      ? Math.round((parsedHours - data.hours.logged) * 10) / 10
      : null
  const remainingMaterial =
    parsedMaterial !== null && !Number.isNaN(parsedMaterial)
      ? Math.round(parsedMaterial - data.actual.materialCostNok)
      : null

  // Har tilbudet en ekte kalkyle, er den det beste utgangspunktet for budsjettet
  // — da slipper man å taste inn tall man allerede har regnet ut én gang.
  const offerSuggestion =
    fromOffer && data.planned
      ? { hours: data.hours.planned, materialNok: data.planned.materialCostNok }
      : null

  return (
    <div className="rounded-lg border">
      <SectionHeader
        title="Mål og framdrift"
        infoTitle="Mål og framdrift"
        info={
          <>
            <p>
              {fromOffer
                ? "Kalkylen for denne jobben hentes fra tilbudslinjene. Setter du et budsjett her i tillegg, er det framdriften som brukes til prognosen."
                : "Fastprisjobber har ingen kalkyle i tilbudet: tilbudet sier hva kunden betaler, ikke hva jobben skal koste. Målet du setter her er det jobben måles mot."}
            </p>
            <p>
              Framdrift er valgfri: har du satt budsjetterte timer, finner vi den fra førte timer,
              ellers fra ferdige oppgaver. Fyller du den inn selv, er det ditt tall som gjelder.
            </p>
          </>
        }
        right={
          offerSuggestion && (offerSuggestion.hours || offerSuggestion.materialNok) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                if (offerSuggestion.hours) setHours(String(offerSuggestion.hours))
                if (offerSuggestion.materialNok)
                  setMaterial(String(Math.round(offerSuggestion.materialNok)))
                toast.info("Hentet fra tilbudets kalkyle — husk å lagre")
              }}
            >
              Hent fra tilbudet
            </Button>
          ) : null
        }
      />
      {/* items-end: «Budsjettert materialkost» brekker til to linjer i en smal
          kolonne, og da skal feltene fortsatt stå på linje. */}
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:items-end">
        <div className="space-y-2">
          <FieldLabel
            htmlFor="budget-hours"
            label="Budsjetterte timer"
            infoTitle="Budsjetterte timer"
            info={
              <>
                <p>Hvor mange timer hele jobben skal ta, ikke hvor mange som er brukt.</p>
                <p>
                  {data.costRateNok > 0
                    ? `Timene regnes om til kroner med kostprisen din, ${formatNok(data.costRateNok)}/t.`
                    : "Ingen av timeprisene dine har kostpris ennå, så timene kan ikke regnes om til kroner. Sett kostpris under Mine priser → Timepriser."}
                </p>
              </>
            }
          />
          <Input
            id="budget-hours"
            inputMode="decimal"
            placeholder="Ikke satt"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          {remainingHours !== null ? (
            <p
              className={cn(
                "text-xs tabular-nums",
                remainingHours < 0 ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {remainingHours < 0
                ? `${formatHours(Math.abs(remainingHours))} over budsjett`
                : `${formatHours(remainingHours)} igjen`}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <FieldLabel
            htmlFor="budget-material"
            label="Budsjettert materialkost"
            infoTitle="Budsjettert materialkost"
            info={
              <>
                <p>Hva materialene til hele jobben skal koste, eks. mva.</p>
                <p>
                  Bruk innkjøpsprisen — det du betaler leverandøren — ikke det kunden faktureres.
                </p>
              </>
            }
          />
          <Input
            id="budget-material"
            inputMode="decimal"
            placeholder="Ikke satt"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
          />
          {remainingMaterial !== null ? (
            <p
              className={cn(
                "text-xs tabular-nums",
                remainingMaterial < 0 ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {remainingMaterial < 0
                ? `${formatNok(Math.abs(remainingMaterial))} over budsjett`
                : `${formatNok(remainingMaterial)} igjen`}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-end border-t px-4 py-3">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Lagrer …" : "Lagre"}
        </Button>
      </div>
    </div>
  )
}

export function LonnsomhetTab({
  projectId,
  canManage,
  initialData,
}: {
  projectId: string
  canManage: boolean
  initialData: ProjectProfitability | null
}) {
  const [data, setData] = useState<ProjectProfitability | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<"prisliste" | "manuelt">("prisliste")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchMaterial[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchMaterial | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [form, setForm] = useState({
    amountNok: "",
    supplierName: "",
    description: "",
    invoiceRef: "",
    costDate: "",
  })

  const debouncedQuery = useDebouncedValue(query, 250)

  const resetDialog = useCallback(() => {
    setMode("prisliste")
    setQuery("")
    setResults([])
    setSelected(null)
    setQuantity("1")
    setForm({ amountNok: "", supplierName: "", description: "", invoiceRef: "", costDate: "" })
  }, [])

  // Søkeresultatene i «Fra prisliste» — samme endepunkt som materialsøket i
  // tilbudsbyggeren, så bedriftens prisfiler er ett søk unna også her.
  useEffect(() => {
    if (!open || mode !== "prisliste" || selected) return

    let cancelled = false
    setSearching(true)

    void (async () => {
      try {
        const params = new URLSearchParams({ type: "material", limit: "12" })
        if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim())

        const response = await fetch(`/api/mine-priser/sok?${params.toString()}`)
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Kunne ikke søke i prisliste")

        if (!cancelled) setResults(payload.materials || [])
      } catch (error) {
        reportClientError(error, { level: "warning", context: { action: "search material prices for cost" } })
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, mode, open, selected])

  function selectMaterial(material: SearchMaterial) {
    setSelected(material)
    setQuantity("1")
    setForm((f) => ({
      ...f,
      supplierName: material.supplier,
      description: material.product,
      amountNok: material.unitPriceNok > 0 ? String(material.unitPriceNok) : f.amountNok,
    }))
  }

  function updateQuantity(value: string) {
    setQuantity(value)
    if (!selected) return
    const qty = Number(value.replace(",", "."))
    if (!Number.isFinite(qty) || qty <= 0) return
    setForm((f) => ({ ...f, amountNok: String(Math.round(qty * selected.unitPriceNok * 100) / 100) }))
  }

  const resultsEmptyLabel = searching
    ? "Søker..."
    : debouncedQuery.trim()
      ? "Ingen treff i prislisten"
      : "Skriv for å søke blant materialer"

  const load = useCallback(() => {
    setLoading(true)
    getProjectProfitabilityAction(projectId)
      .then(setData)
      .catch((e) => {
        reportClientError(e, { context: { action: "laste lønnsomhet", projectId } })
        toast.error(e instanceof Error ? e.message : "Kunne ikke laste lønnsomheten")
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    // Serveren har allerede levert tallene med prosjektsiden. Da skal fanen vise
    // dem med én gang i stedet for å hente det samme på nytt ved åpning.
    if (!initialData) load()
  }, [initialData, load])

  async function handleAdd() {
    const amount = Number(form.amountNok.replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Skriv inn et gyldig beløp")
      return
    }
    setSaving(true)
    try {
      await addMaterialCostAction({
        projectId,
        amountNok: amount,
        supplierName: form.supplierName,
        description: form.description,
        invoiceRef: form.invoiceRef,
        costDate: form.costDate || undefined,
      })
      resetDialog()
      setOpen(false)
      load()
      toast.success("Materialkost lagt til")
    } catch (e) {
      reportClientError(e, { context: { action: "legge til materialkost", projectId } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMaterialCostAction({ projectId, id })
      load()
    } catch (e) {
      reportClientError(e, { context: { action: "slette materialkost", projectId, id } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette")
    }
  }

  if (!data) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {loading ? "Laster lønnsomhet …" : "Fant ingen tall for dette prosjektet."}
      </p>
    )
  }

  const { actual, planned } = data
  // Uten kalkyle faller kalkyle-/avvikskolonnene bort helt: en kolonne full av
  // «—» ser ut som en feil, ikke som «dette vet vi ikke».
  const showPlanned = planned !== null || data.hours.planned !== null
  const marginTone = actual.marginNok >= 0 ? "good" : "bad"
  const plannedWord = data.plannedSource === "budsjett" ? "budsjettert" : "kalkulert"
  const budgetUsedPct =
    data.budgetNok && data.budgetNok > 0
      ? Math.round((actual.totalCostNok / data.budgetNok) * 100)
      : null
  const hoursDiff = data.hours.planned === null ? null : data.hours.logged - data.hours.planned

  return (
    <div className="space-y-5 py-2">
      <div className="flex w-full flex-wrap justify-end space-x-2">
        <Button size="sm" variant="ghost" className="h-8" onClick={load} disabled={loading}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
          Oppdater
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Omsetning (eks. mva)"
          value={formatNok(data.revenueNok)}
          hint={
            data.revenue.changeOrdersNok > 0
              ? `Tilbud ${formatNok(data.revenue.offersNok)} + tillegg ${formatNok(data.revenue.changeOrdersNok)}`
              : data.budgetNok && data.budgetNok > 0
                ? `Totalramme ${formatNok(data.budgetNok)}`
                : "Aksepterte tilbud"
          }
          info={
            <>
              <p>
                Summen av aksepterte tilbud og godkjent tilleggsarbeid på prosjektet, eks. mva.
              </p>
              <p>
                Tilbud som bare er sendt teller ikke — omsetningen øker først når kunden har sagt
                ja.
              </p>
            </>
          }
        />
        <Kpi
          label="Kostnad hittil"
          value={formatNok(actual.totalCostNok)}
          hint={[
            `Lønn ${formatNok(actual.laborCostNok)}`,
            `Material ${formatNok(actual.materialCostNok)}`,
            actual.drivingCostNok > 0 ? `Kjøring ${formatNok(actual.drivingCostNok)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          info={
            <>
              <p>Alt som er påløpt på jobben så langt:</p>
              <p>
                <strong>Lønnskost</strong> = førte timer × kostprisen din.{" "}
                <strong>Materialkost</strong> = det som er registrert nederst på denne siden.{" "}
                <strong>Kjøring</strong> = kjøregodtgjørelse etter statens satser fra kjøreboka.
              </p>
              <p>Avviste timer er ikke med. Private turer er ikke med.</p>
            </>
          }
        />
        <Kpi
          label="Dekningsbidrag"
          value={formatNok(actual.marginNok)}
          tone={marginTone}
          info={
            <>
              <p>Omsetning minus alle prosjektkostnadene — kronene jobben har lagt igjen.</p>
              <p>
                Dette er før faste kostnader som husleie, forsikring og administrasjon. Et positivt
                dekningsbidrag betyr at jobben bidrar til å dekke dem, ikke at bedriften går med
                overskudd.
              </p>
            </>
          }
        />
        <Kpi
          label="Dekningsgrad"
          value={formatMarginPct(actual.marginPct)}
          hint={
            planned?.marginPct != null
              ? `${data.plannedSource === "budsjett" ? "Budsjettert" : "Kalkulert"} ${formatMarginPct(planned.marginPct)}`
              : undefined
          }
          tone={actual.marginPct === null ? undefined : marginTone}
          info={
            <>
              <p>Dekningsbidraget som andel av omsetningen: hvor mange øre av hver krone du sitter igjen med.</p>
              <p>
                Den er lettere å sammenligne mellom jobber enn kronebeløpet — en liten jobb med
                40 % kan være bedre butikk enn en stor med 12 %.
              </p>
            </>
          }
        />
      </div>

      {data.costRateNok === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Lønnskosten regnes som 0 fordi ingen av timeprisene har kostpris (kr/t).{" "}
          <Link
            href="/mine-priser/timepriser"
            className="font-medium underline underline-offset-2"
          >
            Sett kostpris på timeprisene
          </Link>{" "}
          for å få et ekte dekningsbidrag.
        </p>
      ) : null}

      {/* Under KPI-ene går alt i to kolonner fra desktop.
          CSS-kolonner og ikke grid: kortene er svært ulike i høyde (tabellen mot
          et lite prognosekort), og et grid ville låst dem til rader med store
          hull. Kolonneflyten pakker dem tett og balanserer høyden selv.
          På mobil og nettbrett er det én kolonne — halv bredde gjør tabellen
          uleselig. `break-inside-avoid` hindrer at et kort deles i to. */}
      <div className="space-y-5 lg:columns-2 lg:gap-4 lg:space-y-0 lg:[&>*]:mb-4 lg:[&>*]:break-inside-avoid">
      {/* Kalkyle mot faktisk */}
      <div className="rounded-lg border">
        <SectionHeader
          title={
            showPlanned
              ? data.plannedSource === "budsjett"
                ? "Budsjett mot faktisk"
                : "Kalkyle mot faktisk"
              : "Faktisk forbruk"
          }
          infoTitle={showPlanned ? "Slik leses tabellen" : "Faktisk forbruk"}
          info={
            <>
              <p>
                {!showPlanned
                  ? "Det som faktisk er påløpt på prosjektet: førte timer, kjøring og registrerte materialkostnader."
                  : data.plannedSource === "budsjett"
                    ? "Budsjettkolonnen er målet du har satt på prosjektet. Timene er regnet om til kroner med kostprisen din."
                    : "Kalkylekolonnen er selvkost i de aksepterte tilbudene — mengde × innkjøps- eller kostpris, før påslag og rabatt."}
              </p>
              {showPlanned ? (
                <p>
                  Avvik er faktisk minus {data.plannedSource === "budsjett" ? "budsjett" : "kalkyle"}
                  . Grønt er bra: lavere kostnad enn planlagt, eller høyere dekningsbidrag. Rødt
                  betyr at jobben spiser av marginen.
                </p>
              ) : null}
            </>
          }
        />
        <div className="overflow-x-auto px-4 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">Post</th>
                {showPlanned && (
                  <th className="py-2 pr-3 text-right font-medium">
                    {data.plannedSource === "budsjett" ? "Budsjett" : "Kalkyle"}
                  </th>
                )}
                <th className="py-2 pr-3 text-right font-medium">Faktisk</th>
                {showPlanned && <th className="py-2 text-right font-medium">Avvik</th>}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="Lønnskost"
                planned={planned?.laborCostNok ?? null}
                actual={actual.laborCostNok}
                format={formatNok}
                higherIsBetter={false}
                showPlanned={showPlanned}
              />
              <ComparisonRow
                label="Materialkost"
                planned={planned?.materialCostNok ?? null}
                actual={actual.materialCostNok}
                format={formatNok}
                higherIsBetter={false}
                showPlanned={showPlanned}
              />
              {actual.drivingCostNok > 0 && (
                <ComparisonRow
                  label="Kjøregodtgjørelse"
                  planned={null}
                  actual={actual.drivingCostNok}
                  format={formatNok}
                  higherIsBetter={false}
                  showPlanned={showPlanned}
                />
              )}
              <ComparisonRow
                label="Sum kostnad"
                planned={planned?.totalCostNok ?? null}
                actual={actual.totalCostNok}
                format={formatNok}
                higherIsBetter={false}
                showPlanned={showPlanned}
              />
              <ComparisonRow
                label="Dekningsbidrag"
                planned={planned?.marginNok ?? null}
                actual={actual.marginNok}
                format={formatNok}
                higherIsBetter
                strong
                showPlanned={showPlanned}
              />
              <ComparisonRow
                label="Timer"
                planned={data.hours.planned}
                actual={data.hours.logged}
                format={(value) => formatHours(value)}
                higherIsBetter={false}
                showPlanned={showPlanned}
              />
            </tbody>
          </table>
        </div>
        {!planned ? (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            {PLANNED_MISSING_TEXT[data.plannedMissingReason ?? "no_lines"]}
          </p>
        ) : hoursDiff !== null && Math.abs(hoursDiff) >= 1 ? (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            {hoursDiff > 0
              ? `Dere har brukt ${formatHours(hoursDiff)} mer enn ${plannedWord}.`
              : `Dere ligger ${formatHours(Math.abs(hoursDiff))} under ${plannedWord}.`}
            {data.costRateNok > 0
              ? ` Det tilsvarer ${formatNok(Math.abs(hoursDiff) * data.costRateNok)} i lønnskost.`
              : ""}
          </p>
        ) : null}
      </div>

      {/* Mål og framdrift */}
      {canManage ? <BudgetForm projectId={projectId} data={data} onSaved={load} /> : null}

      {/* Forbruk mot totalramme */}
      {budgetUsedPct !== null ? (
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Forbruk mot totalramme</span>
            <span className="tabular-nums text-muted-foreground">
              {formatNok(actual.totalCostNok)} av {formatNok(data.budgetNok ?? 0)} ({budgetUsedPct} %)
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full",
                budgetUsedPct > 100 ? "bg-destructive" : "bg-emerald-600"
              )}
              style={{ width: `${Math.min(100, Math.max(0, budgetUsedPct))}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Lønnskost per person */}
      <div className="rounded-lg border">
        <SectionHeader
          title="Lønnskost per person"
          infoTitle="Lønnskost per person"
          info={
            <>
              <p>Førte timer per person, ganget med kostprisen din.</p>
              <p>
                {data.costRateNok > 0
                  ? `Kostprisen er ${formatNok(data.costRateNok)}/t — snittet av kostprisene på timeprisene dine. Den er per jobbtype, ikke per ansatt, så alle regnes med samme sats.`
                  : "Ingen av timeprisene dine har kostpris ennå, så lønnskosten blir 0 kr."}
              </p>
              <p>
                <Link href="/mine-priser/timepriser" className="underline underline-offset-2">
                  Se timeprisene dine
                </Link>
              </p>
            </>
          }
          right={
            data.costRateNok > 0 ? (
              <p className="text-xs text-muted-foreground">
                Kostpris {formatNok(data.costRateNok)}/t
              </p>
            ) : null
          }
        />
        {data.laborByUser.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Ingen timer ført på prosjektet ennå.
          </p>
        ) : (
          <ul className="divide-y">
            {data.laborByUser.map((entry) => (
              <li key={entry.userId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate text-sm">{entry.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {formatHours(entry.hours)}
                  <span className="ml-3 font-medium text-foreground">{formatNok(entry.costNok)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Materialkostnader */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium">Materialkostnader</p>
            <InfoHint title="Materialkostnader">
              <p>Faktiske innkjøp på prosjektet, eks. mva — det som gjør dekningsgraden ekte.</p>
              <p>
                Registrer det du faktisk har betalt leverandøren. Så lenge denne lista er tom,
                regnes materialkosten som 0 kr, og dekningsgraden blir høyere enn den er.
              </p>
            </InfoHint>
          </div>
          {canManage ? (
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next)
                if (!next) resetDialog()
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Legg til
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Ny materialkost</DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setMode("prisliste")}
                    className={cn(
                      "rounded-md py-1.5 font-medium transition-colors",
                      mode === "prisliste" ? "bg-background shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    Fra prisliste
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("manuelt")
                      setSelected(null)
                    }}
                    className={cn(
                      "rounded-md py-1.5 font-medium transition-colors",
                      mode === "manuelt" ? "bg-background shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    Manuelt
                  </button>
                </div>

                {mode === "prisliste" ? (
                  selected ? (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{selected.product}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[selected.supplier, `${formatNok(selected.unitPriceNok)}/${selected.unit}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => setSelected(null)}
                        >
                          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                          Bytt vare
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="mc-qty">Mengde ({selected.unit})</Label>
                          <Input
                            id="mc-qty"
                            inputMode="decimal"
                            value={quantity}
                            onChange={(e) => updateQuantity(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="mc-amount-picked">Beløp (kr, eks. mva) *</Label>
                          <Input
                            id="mc-amount-picked"
                            inputMode="decimal"
                            value={form.amountNok}
                            onChange={(e) => setForm((f) => ({ ...f, amountNok: e.target.value }))}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="mc-supplier-picked">Leverandør</Label>
                        <Input
                          id="mc-supplier-picked"
                          value={form.supplierName}
                          onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="mc-desc-picked">Beskrivelse</Label>
                        <Input
                          id="mc-desc-picked"
                          value={form.description}
                          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="mc-ref-picked">Fakturaref.</Label>
                          <Input
                            id="mc-ref-picked"
                            value={form.invoiceRef}
                            onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))}
                          />
                        </div>
                        <div>
                          <Label htmlFor="mc-date-picked">Dato</Label>
                          <Input
                            id="mc-date-picked"
                            type="date"
                            value={form.costDate}
                            onChange={(e) => setForm((f) => ({ ...f, costDate: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          autoFocus
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Søk på produkt, NOBB, leverandør..."
                          className="pl-9"
                        />
                      </div>
                      <div className="max-h-[280px] overflow-y-auto">
                        {searching ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Søker...
                          </div>
                        ) : results.length === 0 ? (
                          <p className="py-8 text-center text-sm text-muted-foreground">{resultsEmptyLabel}</p>
                        ) : (
                          <div className="space-y-1">
                            {results.map((material) => (
                              <button
                                key={material.id}
                                type="button"
                                onClick={() => selectMaterial(material)}
                                className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/50"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{material.product}</p>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {[material.supplier, material.unit, material.category].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                <p className="shrink-0 text-sm font-semibold tabular-nums">
                                  {formatNok(material.unitPriceNok)}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Finner du ikke varen?{" "}
                        <button
                          type="button"
                          className="font-medium underline underline-offset-2"
                          onClick={() => setMode("manuelt")}
                        >
                          Skriv den inn manuelt
                        </button>
                        .
                      </p>
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="mc-amount">Beløp (kr, eks. mva) *</Label>
                      <Input
                        id="mc-amount"
                        inputMode="decimal"
                        value={form.amountNok}
                        onChange={(e) => setForm((f) => ({ ...f, amountNok: e.target.value }))}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="mc-supplier">Leverandør</Label>
                      <Input
                        id="mc-supplier"
                        value={form.supplierName}
                        onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="mc-desc">Beskrivelse</Label>
                      <Input
                        id="mc-desc"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="mc-ref">Fakturaref.</Label>
                        <Input
                          id="mc-ref"
                          value={form.invoiceRef}
                          onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="mc-date">Dato</Label>
                        <Input
                          id="mc-date"
                          type="date"
                          value={form.costDate}
                          onChange={(e) => setForm((f) => ({ ...f, costDate: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button onClick={handleAdd} disabled={saving || (mode === "prisliste" && !selected)}>
                    {saving ? "Lagrer …" : "Legg til"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        {data.materialCosts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Ingen materialkostnader registrert ennå.
          </p>
        ) : (
          <ul className="divide-y">
            {data.materialCosts.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.supplier_name || m.description || "Materialkost"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      m.description && m.supplier_name ? m.description : null,
                      m.invoice_ref,
                      m.cost_date,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">
                    {formatNok(Number(m.amount_nok))}
                  </span>
                  {canManage ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => handleDelete(m.id)}
                      aria-label="Slett materialkost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </div>
  )
}
