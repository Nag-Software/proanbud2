"use client"

/**
 * Intern kalkyle på tilbudet: omsetning, kostnad, dekningsbidrag og dekningsgrad
 * regnet av linjene slik de står nå. Kostnaden er materiallinjenes innpris pluss
 * timelinjenes kostpris (fra timeprisen linja ble laget med, ellers bedriftens
 * snitt). Vises bare for den som lager tilbudet — aldri i kundens dokument.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { InfoHint } from "@/components/ui/info-hint"
import { reportClientError } from "@/lib/errors/client"
import { averageCostRate, computeJobCosting, computeOfferRevenue, computePlannedCosts } from "@/lib/job-costing/calc"
import { formatMarginPct } from "@/lib/job-costing/format"
import { fetchHourlyRates, MINE_PRISER_KEYS, MINE_PRISER_MOUNT_MAX_AGE_MS } from "@/lib/mine-priser/client-api"
import { fetchPrefetched, readPrefetched } from "@/lib/perf/prefetch-cache"
import { formatNok, type OfferLineItem } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

type RateRow = { cost_rate_nok: unknown }

function formatHours(value: number) {
  return `${value.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} t`
}

export function OfferCalcStrip({ lineItems, className }: { lineItems: OfferLineItem[]; className?: string }) {
  // Snittet brukes bare på timelinjer uten egen kostpris (eldre linjer). Henting
  // feiler stille: da regnes slike timer med 0, og stripen sier det.
  const [averageCost, setAverageCost] = useState<number | null>(() => {
    const cached = readPrefetched<RateRow[]>(MINE_PRISER_KEYS.timepriser)
    return cached ? averageCostRate(cached) : null
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rates = await fetchPrefetched(MINE_PRISER_KEYS.timepriser, fetchHourlyRates<RateRow>, {
          maxAgeMs: MINE_PRISER_MOUNT_MAX_AGE_MS,
        })
        if (!cancelled) setAverageCost(averageCostRate(rates))
      } catch (error) {
        reportClientError(error, { level: "warning", context: { action: "load hourly rates for offer calc" } })
        if (!cancelled) setAverageCost(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const calc = useMemo(() => {
    const planned = computePlannedCosts(lineItems, { fallbackLaborCostRateNok: averageCost ?? 0 })
    const revenueNok = computeOfferRevenue(lineItems)
    const costing = computeJobCosting({
      revenueNok,
      laborCostNok: planned.laborCostNok,
      materialCostNok: planned.materialCostNok,
    })
    const uncoveredHours = Math.max(0, planned.costBasisHours - planned.laborCostCoveredHours)
    return { planned, costing, uncoveredHours }
  }, [averageCost, lineItems])

  if (lineItems.length === 0) return null

  const { planned, costing, uncoveredHours } = calc
  const hasCostBasis = planned.costBasisRevenueNok > 0
  const marginTone =
    costing.marginPct === null
      ? "text-muted-foreground"
      : costing.marginPct < 0
        ? "text-destructive"
        : costing.marginPct < 15
          ? "text-amber-700 dark:text-amber-400"
          : "text-foreground"

  return (
    <div className={cn("rounded-lg border bg-muted/20 px-4 py-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kalkyle (intern)</p>
          <InfoHint title="Kalkyle (intern)">
            <p>Hva tilbudet ser ut til å gi deg, regnet av linjene slik de står nå. Kunden ser ikke dette.</p>
            <p>
              <strong>Kostnad</strong> = materiallinjenes innpris (før påslag) + timelinjenes kostpris. Kostprisen
              på timer kommer fra timeprisen linja ble lagt til med; timelinjer uten kostpris regnes med snittet av
              kostprisene dine.
            </p>
            <p>
              <strong>Dekningsbidrag</strong> = omsetning − kostnad. Prosenten er dekningsgraden — hvor mange øre av
              hver krone du sitter igjen med før faste kostnader.
            </p>
            <p>Fastprislinjer har bare salgspris, så de gir omsetning uten kostnad her.</p>
          </InfoHint>
        </div>
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Omsetning</dt>
            <dd className="font-medium tabular-nums">{formatNok(costing.revenueNok)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Kostnad</dt>
            <dd className="font-medium tabular-nums">{formatNok(costing.laborCostNok + costing.materialCostNok)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Dekningsbidrag</dt>
            <dd className={cn("font-semibold tabular-nums", marginTone)}>
              {formatNok(costing.marginNok)}
              {costing.marginPct !== null ? (
                <span className="ml-1 text-xs font-medium">({formatMarginPct(costing.marginPct)})</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>
      {!hasCostBasis ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Bare fastprislinjer — tilbudet har ikke noe kostgrunnlag å regne dekningsgrad av.
        </p>
      ) : uncoveredHours > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {averageCost === null
            ? `${formatHours(uncoveredHours)} uten kostpris — henter timeprisene …`
            : averageCost > 0
              ? `${formatHours(uncoveredHours)} mangler kostpris på linja og er regnet med snittet (${formatNok(averageCost)}/t).`
              : `${formatHours(uncoveredHours)} er regnet uten lønnskost: ingen av timeprisene dine har kostpris.`}{" "}
          <Link href="/mine-priser/timepriser" className="underline underline-offset-2 hover:text-foreground">
            Timepriser
          </Link>
        </p>
      ) : null}
    </div>
  )
}
