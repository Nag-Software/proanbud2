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
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { InfoHint } from "@/components/ui/info-hint"
import { formatNok } from "@/lib/tilbud/types"
import { reportClientError, actionErrorMessage } from "@/lib/errors/client"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import { cn } from "@/lib/utils"
import { formatMarginPct } from "@/lib/job-costing/format"

import { getProjectProfitabilityAction } from "./job-costing-actions"
import { CostBudgetSection } from "./cost-budget-section"

function Kpi({
  label,
  value,
  aside,
  hint,
  tone,
  info,
}: {
  label: string
  value: string
  /** Et andre tall på samme linje, mindre (dekningsgraden ved dekningsbidraget). */
  aside?: string
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
          "mt-1 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold tabular-nums",
          tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
        {aside ? <span className="text-base font-medium">{aside}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Hent på nytt når tallene kommer til syne igjen og er eldre enn dette. */
const AUTO_REFRESH_ON_RETURN_MS = 20_000
/** …og jevnlig så lenge man ser på dem. */
const AUTO_REFRESH_INTERVAL_MS = 60_000

export function LonnsomhetTab({
  projectId,
  canManage,
  initialData,
  middle,
  detailsHeading,
  afterDetails,
}: {
  projectId: string
  canManage: boolean
  initialData: ProjectProfitability | null
  /**
   * Innhold mellom nøkkeltallene og kostnadsdetaljene. Økonomi-fanen legger
   * tilbudene her, så budsjettet står rett under tilbudet det kommer fra.
   * Lønnsomheten eier fortsatt tallene (og oppdateringen av dem), så
   * sammendraget og kostnadene aldri kommer i utakt.
   */
  middle?: React.ReactNode
  /** Overskrift over kostnadsdetaljene (brukes som anker på Økonomi). */
  detailsHeading?: React.ReactNode
  /** Innhold etter kostnadene (Økonomi: tilleggsarbeid og fakturering). */
  afterDetails?: React.ReactNode
}) {
  const [data, setData] = useState<ProjectProfitability | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  // Tallene oppdaterer seg selv — det finnes ingen «Oppdater»-knapp. Når de
  // sist ble hentet styrer bakgrunnsoppdateringen under.
  // Rot-elementet byttes når tallene kommer (fra «laster …» til selve
  // visningen), så det holdes i state — observatøren må følge med.
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const fetchedAtRef = useRef(0)

  // `silent`: bakgrunnsoppdatering — ingen spinner og ingen feilmelding (tallene
  // som står der er fortsatt riktige nok; neste runde prøver igjen).
  const load = useCallback(
    ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true)
      getProjectProfitabilityAction(projectId)
        .then((next) => {
          fetchedAtRef.current = Date.now()
          setData(next)
        })
        .catch((e) => {
          reportClientError(e, {
            level: silent ? "warning" : undefined,
            context: { action: "laste lønnsomhet", projectId, silent },
          })
          if (!silent) toast.error(actionErrorMessage(e, "Kunne ikke laste lønnsomheten"))
        })
        .finally(() => {
          if (!silent) setLoading(false)
        })
    },
    [projectId]
  )

  // Serveren har allerede levert tallene med prosjektsiden. Da skal fanen vise
  // dem med én gang i stedet for å hente det samme på nytt ved åpning — og ta
  // imot nye tall når siden rendres på nytt (en endring på prosjektet
  // revaliderer siden, og den friskes opp når man kommer tilbake til fanen).
  const [seenInitialData, setSeenInitialData] = useState(initialData)
  if (initialData !== seenInitialData) {
    setSeenInitialData(initialData)
    if (initialData) setData(initialData)
  }
  useEffect(() => {
    if (initialData) fetchedAtRef.current = Date.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- henter fra serveren når siden ikke leverte tallene
    else load()
  }, [initialData, load])

  // Automatisk oppdatering av det andre registrerer (timer, kjøring, aksept
  // av tilbud): stille i bakgrunnen mens tallene vises.
  const refreshSilently = useCallback(() => load({ silent: true }), [load])
  useAutoRefresh(refreshSilently, rootElement, fetchedAtRef, {
    onReturnMs: AUTO_REFRESH_ON_RETURN_MS,
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
  })

  if (!data) {
    return (
      <div ref={setRootElement} className="space-y-5">
        <p className="p-4 text-sm text-muted-foreground">
          {loading ? "Laster lønnsomhet …" : "Fant ingen tall for dette prosjektet."}
        </p>
        {middle}
        {afterDetails}
      </div>
    )
  }

  const { actual, planned } = data
  const marginTone = actual.marginNok >= 0 ? "good" : "bad"

  return (
    <div ref={setRootElement} className="space-y-5 py-2">

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
                <strong>Lønnskost</strong> = førte timer × kostprisen på timeprisen hver ansatt er koblet til.{" "}
                <strong>Materialkost</strong> = det som er bokført på prosjektet i regnskapet, pluss
                innkjøp lagt inn her som ikke er bokført ennå.{" "}
                <strong>Kjøring</strong> = kjøregodtgjørelse etter statens satser fra kjøreboka.
              </p>
              <p>Avviste timer er ikke med. Private turer er ikke med.</p>
            </>
          }
        />
        {/* Dekningsbidrag og -grad er samme tall i to former — ett kort, så det
            blir plass til «Fakturert». */}
        <Kpi
          label="Dekningsbidrag"
          value={formatNok(actual.marginNok)}
          aside={actual.marginPct === null ? undefined : formatMarginPct(actual.marginPct)}
          hint={
            planned?.marginPct != null
              ? `${data.plannedSource === "budsjett" ? "Budsjettert" : "Kalkulert"} ${formatMarginPct(planned.marginPct)}`
              : undefined
          }
          tone={marginTone}
          info={
            <>
              <p>Omsetning minus alle prosjektkostnadene — kronene jobben har lagt igjen.</p>
              <p>
                Prosenten er dekningsgraden: hvor mange øre av hver krone du sitter igjen med. Den er
                lettere å sammenligne mellom jobber enn kronebeløpet.
              </p>
              <p>
                Dette er før faste kostnader som husleie, forsikring og administrasjon. Et positivt
                dekningsbidrag betyr at jobben bidrar til å dekke dem, ikke at bedriften går med
                overskudd.
              </p>
            </>
          }
        />
        <Kpi
          label="Fakturert"
          value={formatNok(data.invoiced.totalNok)}
          hint={[
            data.revenueNok > 0
              ? `${Math.round((data.invoiced.totalNok / data.revenueNok) * 100)} % av omsetningen`
              : null,
            data.invoiced.paidNok > 0 ? `Betalt ${formatNok(data.invoiced.paidNok)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          info={
            data.invoiced.source === "regnskap" ? (
              <>
                <p>
                  Inntekt bokført på prosjektet i regnskapet, eks. mva — også fakturaer som er laget
                  direkte der. Hentes hver natt, sammen med kostnadene.
                </p>
                <p>
                  Dekningsbidraget regnes fortsatt på omsetningen (aksepterte tilbud og tillegg), så det
                  stemmer også midt i jobben, før alt er fakturert.
                </p>
              </>
            ) : (
              <p>
                Fakturaene som er registrert på prosjektet i ProAnbud, eks. mva. Med regnskapet koblet til
                hentes også fakturaer som er laget direkte der.
              </p>
            )
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
      ) : data.laborRates.missing.length > 0 ? (
        // Mildere enn varselet over: tallet er ekte, men grovere enn det kunne vært.
        <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
          {data.laborRates.missing.length === 1
            ? `${data.laborRates.missing[0].name} er ikke koblet til en timepris og regnes med snittet (${formatNok(data.costRateNok)}/t).`
            : `${data.laborRates.missing.length} ansatte er ikke koblet til en timepris og regnes med snittet (${formatNok(data.costRateNok)}/t).`}{" "}
          {canManage ? (
            <Link href="/min-bedrift/ansatte-og-roller" className="font-medium underline underline-offset-2">
              Koble ansatte til timepriser
            </Link>
          ) : null}
        </p>
      ) : null}

      {middle}

      <CostBudgetSection
        projectId={projectId}
        canManage={canManage}
        data={data}
        heading={detailsHeading}
        onChanged={() => load({ silent: true })}
      />

      {afterDetails}
    </div>
  )
}
