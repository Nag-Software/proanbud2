"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { CheckIcon, Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { reportClientError } from "@/lib/errors/client"
import {
  MODULE_CATALOG,
  MODULES_INCLUDED_IN_PROFF,
  PROFF_INCLUDED_FEATURES,
  type BillingInterval,
  type ModuleKey,
  type PlanKey,
} from "@/lib/billing/plans"

type BillingSummary = {
  has_billing: boolean
  status: string
  plan_key: PlanKey | null
  plan_label: string | null
  billing_interval: BillingInterval | null
  quota_limit: number
  used: number
  overage: number
  period_start: string | null
  period_end: string | null
  trial_ends_at: string | null
  cancel_at_period_end?: boolean
  cancel_at?: string | null
  seat_count: number
  billable_seats: number
  included_seats: number
  chargeable_seats: number
  seat_price_nok: number
  overage_unit_nok: number
  pricing: { monthlyNok: number; yearlyTotalNok: number } | null
  modules: Array<{ module_key: string; enabled_at: string; monthly_nok: number | null }>
}

const STATUS_LABELS: Record<string, string> = {
  trialing: "Prøveperiode",
  active: "Aktiv",
  past_due: "Betaling mangler",
  canceled: "Avsluttet",
  incomplete: "Ikke startet",
  unpaid: "Ubetalt",
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function intervalLabel(interval: BillingInterval | null) {
  if (interval === "year") return "Årlig"
  if (interval === "month") return "Månedlig"
  return null
}

export function BillingPageClient() {
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set())

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/billing/summary")
      if (!res.ok) throw new Error("Kunne ikke hente abonnement")
      const data = (await res.json()) as BillingSummary
      setSummary(data)
      setEnabledModules(new Set(data.modules.map((m) => m.module_key)))
    } catch (error) {
      reportClientError(error, { context: { action: "hent abonnement-sammendrag" } })
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  // Trial → opens Stripe checkout (no subscription yet). Upgrade → the server
  // changes the plan in place on the existing subscription and returns
  // { changed: true } (no redirect), avoiding a second/double-charged sub.
  async function submitPlanChange(opts: { trial?: boolean }) {
    setActionLoading("checkout")
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: "proff",
          interval: "month",
          ...(opts.trial ? { trial: true } : {}),
          successPath: "/innstillinger/betaling?checkout=success",
          cancelPath: "/innstillinger/betaling",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Noe gikk galt")
      if (data.url) {
        window.location.href = data.url
        return
      }
      if (data.changed) toast.success("Abonnementet er oppgradert til Proff.")
      await loadSummary()
    } catch (error) {
      reportClientError(error, { context: { action: "start checkout / planbytte" } })
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    } finally {
      setActionLoading(null)
    }
  }

  async function openPortal() {
    setActionLoading("portal")
    try {
      const res = await fetch("/api/stripe/customer-portal", { method: "POST" })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) throw new Error(data.error || "Portal feilet")
      if (!data.url) throw new Error("Kunne ikke opprette betalingsportal.")
      window.location.replace(data.url)
    } catch (error) {
      setActionLoading(null)
      reportClientError(error, { context: { action: "åpne betalingsportal" } })
      toast.error(error instanceof Error ? error.message : "Portal feilet")
    }
  }

  async function endTrial() {
    setActionLoading("end-trial")
    try {
      const res = await fetch("/api/stripe/end-trial", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Kunne ikke avslutte prøve")
      toast.success("Abonnementet er nå aktivt.")
      await loadSummary()
    } catch (error) {
      reportClientError(error, { context: { action: "avslutt prøveperiode" } })
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    } finally {
      setActionLoading(null)
    }
  }

  async function toggleModule(moduleKey: ModuleKey, label: string, enabled: boolean) {
    setActionLoading(`module:${moduleKey}`)
    // Optimistic update
    setEnabledModules((prev) => {
      const next = new Set(prev)
      if (enabled) next.add(moduleKey)
      else next.delete(moduleKey)
      return next
    })
    try {
      const res = await fetch("/api/stripe/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleKey, enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Kunne ikke oppdatere modul")
      toast.success(enabled ? `${label} aktivert` : `${label} deaktivert`)
      await loadSummary()
    } catch (error) {
      reportClientError(error, { context: { action: "veksle modul", moduleKey, enabled } })
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
      // Revert optimistic update
      setEnabledModules((prev) => {
        const next = new Set(prev)
        if (enabled) next.delete(moduleKey)
        else next.add(moduleKey)
        return next
      })
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isActive = summary?.status === "active" || summary?.status === "trialing"
  const usagePercent =
    summary && summary.quota_limit > 0
      ? Math.min(100, Math.round((summary.used / summary.quota_limit) * 100))
      : 0

  if (!isActive) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10 md:px-6">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Betaling</h1>
          <p className="text-sm text-muted-foreground">
            14 dager Proff gratis · kort kreves · ingen belastning nå
          </p>
        </div>
        <Button
          className="mt-8 h-11 w-full"
          onClick={() => submitPlanChange({ trial: true })}
          disabled={actionLoading !== null}
        >
          {actionLoading === "checkout" && (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          )}
          Start gratis prøveperiode
        </Button>
      </div>
    )
  }

  const trialEnd = formatDate(summary?.trial_ends_at ?? null)
  const interval = intervalLabel(summary?.billing_interval ?? null)
  const isProff = summary?.plan_key === "proff"
  const cancelDate = summary?.cancel_at_period_end
    ? formatDate(summary?.cancel_at ?? summary?.period_end ?? null)
    : null
  const renewDate = formatDate(summary?.period_end ?? null)
  const includedSeats = summary?.included_seats ?? 0
  const billableSeats = summary?.billable_seats ?? 0
  const chargeableSeats = summary?.chargeable_seats ?? 0
  const seatPercent =
    includedSeats > 0
      ? Math.min(100, Math.round((billableSeats / includedSeats) * 100))
      : billableSeats > 0
        ? 100
        : 0
  const planPriceLabel = summary?.pricing
    ? summary.billing_interval === "year"
      ? `${summary.pricing.monthlyNok} kr/mnd · faktureres årlig`
      : `${summary.pricing.monthlyNok} kr/mnd`
    : null

  return (
    <div className="w-full max-w-5xl space-y-6 px-4 py-6 md:px-6">
      {cancelDate && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Abonnementet avsluttes {cancelDate}. Du beholder tilgangen til da. Åpne «Administrer
          betaling» for å gjenoppta abonnementet.
        </div>
      )}

      {/* Overview: plan, key stats and the primary action */}
      <section className="rounded-xl border">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold">{summary?.plan_label ?? "Abonnement"}</p>
              {summary?.status && (
                <Badge variant={summary.status === "active" ? "default" : "secondary"}>
                  {STATUS_LABELS[summary.status] ?? summary.status}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {[interval, summary?.status === "trialing" && trialEnd && `prøve til ${trialEnd}`]
                .filter(Boolean)
                .join(" · ") || "Abonnement"}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={openPortal}
              disabled={actionLoading !== null}
            >
              {actionLoading === "portal" && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Administrer betaling
            </Button>
            {summary?.status === "trialing" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={endTrial}
                disabled={actionLoading !== null}
              >
                {actionLoading === "end-trial" && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                Start betaling nå
              </Button>
            )}
          </div>
        </div>

        <div className="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="space-y-2 p-5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground">Tilbud generert</span>
              <span className="text-sm font-medium">
                {summary?.used ?? 0} / {summary?.quota_limit ?? 0}
              </span>
            </div>
            <Progress value={usagePercent} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              {(summary?.overage ?? 0) > 0
                ? `${summary?.overage} over à ${summary?.overage_unit_nok} kr på neste faktura`
                : "Inkludert i abonnementet"}
            </p>
          </div>

          <div className="space-y-2 p-5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground">Ansattlisenser</span>
              <span className="text-sm font-medium">
                {billableSeats}
                {includedSeats > 0 ? ` / ${includedSeats}` : ""}
              </span>
            </div>
            <Progress value={seatPercent} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              {chargeableSeats > 0
                ? `${chargeableSeats} ekstra à ${summary?.seat_price_nok} kr/mnd`
                : includedSeats > 0
                  ? "Innenfor inkluderte lisenser"
                  : "Admin er alltid gratis"}
            </p>
          </div>

          <div className="space-y-2 p-5">
            <p className="text-sm text-muted-foreground">{cancelDate ? "Avsluttes" : "Fornyes"}</p>
            <p className="text-sm font-medium">{cancelDate ?? renewDate ?? "—"}</p>
            {planPriceLabel && <p className="text-xs text-muted-foreground">{planPriceLabel}</p>}
          </div>
        </div>
      </section>

      {/* Details: what Proff includes + à-la-carte modules, side by side on desktop */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="h-fit rounded-xl border">
          <div className="space-y-1 border-b p-5">
            <p className="font-semibold">Dette følger med i Proff</p>
            <p className="text-sm text-muted-foreground">
              {isProff ? "Inkludert i ditt abonnement" : "Oppgrader til Proff for å låse opp"}
            </p>
          </div>
          <ul className="space-y-3 p-5">
            {PROFF_INCLUDED_FEATURES.map((feature) => (
              <li key={feature.key} className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{feature.label}</p>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              </li>
            ))}
          </ul>
          {!isProff && (
            <div className="border-t p-5">
              <Button
                type="button"
                className="w-full"
                onClick={() => submitPlanChange({})}
                disabled={actionLoading !== null}
              >
                {actionLoading === "checkout" && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                Oppgrader til Proff
              </Button>
            </div>
          )}
        </section>

        <section className="h-fit rounded-xl border">
          <div className="space-y-1 border-b p-5">
            <p className="font-semibold">Moduler</p>
            <p className="text-sm text-muted-foreground">
              Slå på det du trenger — Outlook og Google Drive er alltid gratis.
            </p>
          </div>
          <div className="divide-y">
            {MODULE_CATALOG.map((module) => {
              const includedInProff = MODULES_INCLUDED_IN_PROFF.includes(module.key) && isProff
              return (
                <div
                  key={module.key}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{module.label}</p>
                    <p className="text-xs text-muted-foreground">{module.description}</p>
                    {!includedInProff && (
                      <p className="mt-1 text-xs font-medium text-foreground">
                        {module.monthlyNok} kr/mnd
                      </p>
                    )}
                  </div>
                  {includedInProff ? (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <CheckIcon className="size-3" />
                      Inkludert i Proff
                    </Badge>
                  ) : (
                    <Switch
                      checked={enabledModules.has(module.key)}
                      disabled={actionLoading !== null}
                      onCheckedChange={(checked) => toggleModule(module.key, module.label, checked)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
