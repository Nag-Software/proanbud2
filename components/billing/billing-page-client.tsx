"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import type { BillingInterval, PlanKey } from "@/lib/billing/plans"

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
  seat_count: number
  billable_seats: number
  included_seats: number
  chargeable_seats: number
  seat_price_nok: number
  overage_unit_nok: number
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

function BillingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(searchParams.get("checkout") === "success")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [timeforingEnabled, setTimeforingEnabled] = useState(false)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/billing/summary")
      if (!res.ok) throw new Error("Kunne ikke hente abonnement")
      const data = (await res.json()) as BillingSummary
      setSummary(data)
      setTimeforingEnabled(data.modules.some((m) => m.module_key === "timeforing"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      // Etter retur fra Stripe-checkout: bekreft abonnementet før vi leser
      // status, slik at siden viser korrekt tilstand selv om webhooken er treg.
      if (searchParams.get("checkout") === "success") {
        const sessionId = searchParams.get("session_id")
        try {
          const res = await fetch("/api/stripe/confirm-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sessionId ? { sessionId } : { reconcile: true }),
          })
          const data = await res.json()
          if (!res.ok) {
            throw new Error(data.error || "Kunne ikke aktivere abonnement")
          }
        } catch (error) {
          if (!cancelled) {
            toast.error(error instanceof Error ? error.message : "Aktivering feilet")
          }
        } finally {
          if (!cancelled) {
            // Rydd query-parameterne fra URL etter aktivering.
            router.replace("/innstillinger/betaling")
            setActivating(false)
          }
        }
      }

      if (!cancelled) {
        await loadSummary()
      }
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSummary])

  if (activating) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <Loader2Icon className="size-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Aktiverer abonnement …</p>
      </div>
    )
  }

  async function startCheckout() {
    setActionLoading("checkout")
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: "proff",
          interval: "month",
          trial: true,
          successPath: "/innstillinger/betaling?checkout=success",
          cancelPath: "/innstillinger/betaling",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Checkout feilet")
      if (data.url) window.location.href = data.url
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout feilet")
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
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
    } finally {
      setActionLoading(null)
    }
  }

  async function toggleTimeforing(enabled: boolean) {
    setActionLoading("timeforing")
    try {
      const res = await fetch("/api/stripe/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleKey: "timeforing", enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Kunne ikke oppdatere modul")
      setTimeforingEnabled(enabled)
      toast.success(enabled ? "Timeføring aktivert" : "Timeføring deaktivert")
      await loadSummary()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Noe gikk galt")
      setTimeforingEnabled(!enabled)
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
          onClick={startCheckout}
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

  return (
    <div className="w-full max-w-lg space-y-8 px-4 py-6 md:px-6">
      <section className="rounded-xl border">
        <div className="space-y-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{summary?.plan_label ?? "Abonnement"}</p>
              <p className="text-sm text-muted-foreground">
                {[interval, summary?.status === "trialing" && trialEnd && `prøve til ${trialEnd}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {summary?.status && (
              <Badge variant={summary.status === "active" ? "default" : "secondary"}>
                {STATUS_LABELS[summary.status] ?? summary.status}
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t px-5 py-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">KI-tilbud</span>
            <span>
              {summary?.used ?? 0} / {summary?.quota_limit ?? 0}
            </span>
          </div>
          <Progress value={usagePercent} className="h-1.5" />
          {(summary?.overage ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary?.overage} overforbruk à {summary?.overage_unit_nok} kr på neste faktura
            </p>
          )}
        </div>

        <div className="space-y-2 border-t p-5">
          <Button
            type="button"
            className="w-full"
            onClick={openPortal}
            disabled={actionLoading !== null}
          >
            {actionLoading === "portal" && (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            )}
            Administrer betaling
          </Button>
          {summary?.status === "trialing" && (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
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
      </section>

      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">Tillegg</p>
        <div className="flex items-center justify-between rounded-xl border px-5 py-4">
          <div>
            <p className="text-sm font-medium">Timeføring</p>
            <p className="text-xs text-muted-foreground">29 kr/mnd</p>
          </div>
          <Switch
            checked={timeforingEnabled}
            disabled={actionLoading !== null}
            onCheckedChange={toggleTimeforing}
          />
        </div>

        <div className="rounded-xl border px-5 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Ansatte</p>
            <p className="text-sm text-muted-foreground">
              {summary?.billable_seats ?? 0} ({summary?.included_seats ?? 0} inkludert)
            </p>
          </div>
          {(summary?.chargeable_seats ?? 0) > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {summary?.chargeable_seats} ekstra{" "}
              {summary?.chargeable_seats === 1 ? "sete" : "seter"} à{" "}
              {summary?.seat_price_nok} kr/mnd ={" "}
              {(summary?.chargeable_seats ?? 0) * (summary?.seat_price_nok ?? 0)} kr/mnd
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

export function BillingPageClient() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <BillingPageInner />
    </Suspense>
  )
}
