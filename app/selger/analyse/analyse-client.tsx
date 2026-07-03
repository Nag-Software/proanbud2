"use client"

// Analyse — fra motor-metrikk til SALGS-metrikk: pipeline-fordeling,
// aktivitetsvolum, e-post-engasjement og vunnet/tapt med årsaker.

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { cn } from "@/lib/utils"
import {
  OPEN_PIPELINE_STATUSES,
  PROSPECT_STATUS_LABELS,
} from "@/lib/outreach/types"
import { LOST_REASON_LABELS } from "@/lib/selger/types"
import type { SalesMetrics } from "@/lib/selger/email-metrics"

const PERIODS = [
  { days: 30, label: "30 d" },
  { days: 90, label: "90 d" },
  { days: 365, label: "1 år" },
]

function pct(part: number, total: number): string {
  if (total === 0) return "–"
  return `${Math.round((part / total) * 100)} %`
}

export function AnalyseClient({ metrics }: { metrics: SalesMetrics }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const openTotal = OPEN_PIPELINE_STATUSES.reduce(
    (sum, status) => sum + (metrics.pipelineCounts[status] ?? 0),
    0
  )
  const maxColumn = Math.max(
    1,
    ...OPEN_PIPELINE_STATUSES.map((status) => metrics.pipelineCounts[status] ?? 0)
  )
  const closedTotal = metrics.won + metrics.lost

  const kpis = [
    { label: `Vunnet siste ${metrics.periodDays} d`, value: String(metrics.won) },
    { label: "Åpne leads", value: String(openTotal) },
    { label: "Åpningsrate e-post", value: pct(metrics.email.opened, metrics.email.sent) },
    { label: "Klikkrate e-post", value: pct(metrics.email.clicked, metrics.email.sent) },
  ]

  const activityItems = [
    { label: "Samtaler", value: metrics.activity.calls },
    { label: "E-poster", value: metrics.activity.emails },
    { label: "Notater", value: metrics.activity.notes },
    { label: "Fullførte oppgaver", value: metrics.activity.tasksDone },
  ]

  return (
    <SelgerPageShell segments={["Selger", "Analyse"]}>
      <div className="flex flex-col gap-4 px-4 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Analyse</h1>
            <p className="text-xs text-muted-foreground">
              Salget i tall — pipeline, aktivitet og utfall.
            </p>
          </div>
          <div className="ml-auto inline-flex overflow-hidden rounded-md border">
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                onClick={() => {
                  const params = new URLSearchParams(searchParams.toString())
                  params.set("periode", String(period.days))
                  router.replace(`/selger/analyse?${params.toString()}`)
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold",
                  metrics.periodDays === period.days
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-secondary"
                )}
              >
                {period.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI-rad */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-lg border bg-card px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {kpi.label}
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight">{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Pipeline-fordeling */}
          <div className="rounded-lg border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Pipeline nå
            </p>
            <div className="mt-3 space-y-2.5">
              {OPEN_PIPELINE_STATUSES.map((status) => {
                const count = metrics.pipelineCounts[status] ?? 0
                return (
                  <div key={status}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium">{PROSPECT_STATUS_LABELS[status]}</span>
                      <span className="font-bold tabular-nums">{count}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(count / maxColumn) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              <div className="flex items-baseline justify-between border-t pt-2 text-xs">
                <span className="text-muted-foreground">Innboks (ikke kvalifisert)</span>
                <span className="font-bold tabular-nums">{metrics.pipelineCounts.ny ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Aktivitet */}
          <div className="rounded-lg border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Aktivitet siste {metrics.periodDays} d
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {activityItems.map((item) => (
                <div key={item.label} className="rounded border bg-secondary/40 px-3 py-2.5">
                  <p className="text-lg font-bold tabular-nums">{item.value}</p>
                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t pt-2.5 text-xs text-muted-foreground">
              E-post: {metrics.email.sent} sendt · {metrics.email.opened} åpnet ·{" "}
              {metrics.email.clicked} klikket · {metrics.email.bounced} returnert
            </p>
          </div>
        </div>

        {/* Vunnet / tapt */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Utfall siste {metrics.periodDays} d
            </p>
            <div className="mt-3 flex items-center gap-6">
              <div>
                <p className="text-2xl font-bold text-lime-700 dark:text-lime-400">{metrics.won}</p>
                <p className="text-[11px] text-muted-foreground">Vunnet</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">{metrics.lost}</p>
                <p className="text-[11px] text-muted-foreground">Tapt</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{pct(metrics.won, closedTotal)}</p>
                <p className="text-[11px] text-muted-foreground">Vinnrate</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Tapt-årsaker
            </p>
            {Object.keys(metrics.lostReasons).length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Ingen tapte leads i perioden.</p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {Object.entries(metrics.lostReasons)
                  .sort(([, a], [, b]) => b - a)
                  .map(([reason, count]) => (
                    <div key={reason} className="flex items-baseline justify-between text-xs">
                      <span className="font-medium">
                        {(LOST_REASON_LABELS as Record<string, string>)[reason] ?? reason}
                      </span>
                      <span className="font-bold tabular-nums">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {openTotal === 0 && metrics.won === 0 && (
          <p className="text-center text-xs text-muted-foreground">
            For lite data ennå — kom tilbake når du har jobbet noen leads.
          </p>
        )}
      </div>
    </SelgerPageShell>
  )
}
