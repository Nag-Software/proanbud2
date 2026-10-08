"use client"

import { useState } from "react"
import { CheckIcon, Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PLAN_LABELS,
  PLAN_SUMMARIES,
  planPricingFor,
  type BillingInterval,
  type PlanKey,
  type PriceCohort,
} from "@/lib/billing/plans"

const PLAN_ORDER: PlanKey[] = ["mini", "proff"]

export type PlanChoice = { plan: PlanKey; interval: BillingInterval }

type PlanPickerProps = {
  /** Hvilken prisliste bedriften står på (gammel/ny). */
  cohort: PriceCohort
  /** Planen bedriften har i dag — null når det ikke finnes noe abonnement. */
  currentPlan?: PlanKey | null
  currentInterval?: BillingInterval | null
  onSelect: (choice: PlanChoice) => void
  /** Låser alle knapper (mens en forespørsel pågår). */
  disabled?: boolean
  /** Planen som behandles akkurat nå — viser spinner på den knappen. */
  pendingPlan?: PlanKey | null
}

function formatNok(value: number) {
  return value.toLocaleString("nb-NO")
}

/**
 * Planvelgeren: Mini og Proff side om side med månedlig/årlig-bryter.
 *
 * Brukes både når bedriften skal velge sitt første betalte abonnement
 * (onboarding, prøven er brukt) og for å bytte plan opp eller ned på et
 * aktivt abonnement. Vises aldri i Proanbud-appen (App Store 3.1.1 — ingen
 * priser eller kjøp der); kallerne skjuler den der.
 */
export function PlanPicker({
  cohort,
  currentPlan = null,
  currentInterval = null,
  onSelect,
  disabled = false,
  pendingPlan = null,
}: PlanPickerProps) {
  // Rader uten kjent intervall (eldre abonnement) behandles som månedlige — det
  // er det eneste intervallet de kan ha fått uten at synken fant årspris.
  const effectiveInterval: BillingInterval | null = currentPlan ? (currentInterval ?? "month") : null
  const [interval, setInterval] = useState<BillingInterval>(effectiveInterval ?? "month")
  // Følg abonnementet når det endres utenfra (summary lastes på nytt etter
  // portal- eller planbytte) så «Nåværende plan» alltid peker riktig. Justeres
  // under render (Reacts anbefalte mønster), ikke i en effekt.
  const [syncedInterval, setSyncedInterval] = useState(effectiveInterval)
  if (effectiveInterval !== syncedInterval) {
    setSyncedInterval(effectiveInterval)
    if (effectiveInterval) setInterval(effectiveInterval)
  }
  const pricing = planPricingFor(cohort)
  const hasSubscription = currentPlan !== null

  return (
    <div className="space-y-4">
      <div
        role="radiogroup"
        aria-label="Faktureringsintervall"
        className="mx-auto flex w-fit items-center gap-1 rounded-lg bg-muted p-1"
      >
        {(["month", "year"] as const).map((option) => {
          const active = interval === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setInterval(option)}
              disabled={disabled}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option === "month" ? "Månedlig" : "Årlig"}
              {option === "year" && (
                <span className={cn("ml-1.5 text-xs", active ? "text-primary" : "")}>
                  spar opptil{" "}
                  {Math.max(
                    ...PLAN_ORDER.map(
                      (plan) =>
                        pricing[plan].month.yearlyTotalNok - pricing[plan].year.yearlyTotalNok
                    )
                  ).toLocaleString("nb-NO")}{" "}
                  kr
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PLAN_ORDER.map((plan) => {
          const summary = PLAN_SUMMARIES[plan]
          const price = pricing[plan][interval]
          const isCurrent = currentPlan === plan && effectiveInterval === interval
          const samePlanOtherInterval = currentPlan === plan && !isCurrent
          const isPending = pendingPlan === plan

          let cta: string
          if (!hasSubscription) {
            cta = `Velg ${PLAN_LABELS[plan]}`
          } else if (isCurrent) {
            cta = "Nåværende plan"
          } else if (samePlanOtherInterval) {
            cta = interval === "year" ? "Bytt til årlig betaling" : "Bytt til månedlig betaling"
          } else {
            cta = `Bytt til ${PLAN_LABELS[plan]}`
          }

          return (
            <div
              key={plan}
              data-plan={plan}
              className={cn(
                "flex flex-col rounded-xl border p-5",
                summary.recommended && "border-primary ring-1 ring-primary",
                isCurrent && "bg-muted/40"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-semibold">{PLAN_LABELS[plan]}</p>
                {currentPlan === plan ? (
                  <Badge variant="secondary">Din plan</Badge>
                ) : summary.recommended ? (
                  <Badge>Anbefalt</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{summary.tagline}</p>

              <div className="mt-4">
                <p className="text-3xl font-semibold tracking-tight">
                  {formatNok(price.monthlyNok)} kr
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/mnd</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {interval === "year"
                    ? `eks. mva · faktureres ${formatNok(price.yearlyTotalNok)} kr/år`
                    : "eks. mva · ingen binding"}
                </p>
              </div>

              <ul className="mt-4 flex-1 space-y-2">
                {summary.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-sm">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <Button
                type="button"
                size="lg"
                variant={summary.recommended && !isCurrent ? "default" : "outline"}
                className="mt-5 w-full"
                onClick={() => onSelect({ plan, interval })}
                disabled={disabled || isCurrent}
              >
                {isPending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                {cta}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
