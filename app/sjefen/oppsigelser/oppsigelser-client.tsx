"use client"

import { type ReactNode, useMemo, useState } from "react"
import Link from "next/link"
import { BadgePercent, CalendarClock, MessageSquareQuote, RotateCcw, Search, UserMinus } from "lucide-react"

import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDate } from "@/lib/sjefen/format"
import type {
  CancellationDashboard,
  CancellationRow,
  CancellationState,
} from "@/lib/platform/cancellations"

const STATE_LABEL: Record<CancellationState, string> = {
  scheduled: "Avsluttes",
  ended: "Avsluttet",
  resumed: "Angret",
  discounted: "Beholdt med 50 %",
}

function stateClasses(state: CancellationState) {
  if (state === "scheduled") return "border-amber-500/30 bg-amber-500/15 text-amber-600"
  if (state === "ended") return "border-destructive/30 bg-destructive/10 text-destructive"
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
}

const PLAN_LABEL: Record<string, string> = { mini: "Mini", proff: "Proff" }

/** «Proff · prøve» / «Proff · 5 mnd» — plan og hvor lenge de hadde vært kunde. */
function customerSummary(row: CancellationRow) {
  const parts: string[] = []
  if (row.plan_key) parts.push(PLAN_LABEL[row.plan_key] ?? row.plan_key)
  if (row.status_at_cancel === "trialing") {
    parts.push("prøve")
  } else if (row.subscribed_since) {
    const days = Math.max(
      0,
      Math.round(
        (new Date(row.created_at).getTime() - new Date(row.subscribed_since).getTime()) / 86_400_000
      )
    )
    parts.push(days < 60 ? `${days} dager` : `${Math.round(days / 30)} mnd`)
  }
  if (row.billing_interval === "year") parts.push("årlig")
  return parts.join(" · ")
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export function OppsigelserClient({ dashboard }: { dashboard: CancellationDashboard }) {
  const [search, setSearch] = useState("")
  const [reason, setReason] = useState("all")
  const [state, setState] = useState("all")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return dashboard.rows.filter((row) => {
      if (reason !== "all" && row.reason !== reason) return false
      if (state !== "all" && row.state !== state) return false
      if (
        q &&
        !(row.company_name ?? "").toLowerCase().includes(q) &&
        !(row.detail ?? "").toLowerCase().includes(q) &&
        !(row.user_email ?? "").toLowerCase().includes(q)
      )
        return false
      return true
    })
  }, [dashboard.rows, search, reason, state])

  const maxCount = Math.max(1, ...dashboard.reasons.map((r) => r.count))
  const { summary } = dashboard

  return (
    <SjefenPageShell segments={["Sjefen", "Oppsigelser"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Frafall
          </p>
          <h1 className="text-2xl font-semibold text-foreground">Oppsigelser</h1>
          <p className="text-sm text-muted-foreground">
            Hvorfor kunder avslutter abonnementet – grunnen er obligatorisk når de sier opp.
          </p>
        </div>

        {dashboard.loadError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            Kunne ikke lese oppsigelser. Er db/110 kjørt? ({dashboard.loadError})
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<UserMinus className="size-5" />}
            label="Siste 30 dager"
            value={summary.last30Days}
          />
          <StatCard
            icon={<MessageSquareQuote className="size-5" />}
            label="Vanligste grunn"
            value={summary.topReason ?? "—"}
          />
          <StatCard
            icon={<BadgePercent className="size-5" />}
            label="Beholdt med 50 %"
            value={summary.discounted}
          />
          <StatCard icon={<RotateCcw className="size-5" />} label="Angret" value={summary.resumed} />
        </div>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Grunner</p>
              <p className="text-xs text-muted-foreground">{summary.total} svar totalt</p>
            </div>
            <div className="space-y-1">
              {dashboard.reasons.map((item) => {
                const active = reason === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setReason(active ? "all" : item.key)}
                    aria-pressed={active}
                    className={
                      "grid w-full grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 " +
                      (active ? "bg-muted" : "")
                    }
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-foreground"
                        style={{ width: `${(item.count / maxCount) * 100}%` }}
                      />
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {item.count}
                      {summary.total > 0 && (
                        <span className="ml-1 text-xs">
                          ({Math.round((item.count / summary.total) * 100)} %)
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Søk i oppsigelser"
              placeholder="Søk i firma eller utdypning…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-[220px]" aria-label="Filtrer på grunn">
              <SelectValue placeholder="Grunn" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle grunner</SelectItem>
              {dashboard.reasons.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="w-[180px]" aria-label="Filtrer på status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statuser</SelectItem>
              {(Object.keys(STATE_LABEL) as CancellationState[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {STATE_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <CalendarClock className="size-8 text-muted-foreground" />
              <p className="font-medium text-foreground">Ingen oppsigelser å vise</p>
              <p className="text-sm text-muted-foreground">
                {dashboard.rows.length === 0
                  ? "Ingen har sagt opp ennå. Svarene dukker opp her når noen gjør det."
                  : "Ingen oppsigelser matcher filteret."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <Card key={row.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={stateClasses(row.state)}>
                      {row.state === "scheduled" && row.cancel_at
                        ? `Avsluttes ${formatDate(row.cancel_at)}`
                        : STATE_LABEL[row.state]}
                    </Badge>
                    <Badge variant="secondary">{row.reason_label}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    {row.company_id ? (
                      <Link
                        href={`/sjefen/firmaer/${row.company_id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {row.company_name ?? "Uten navn"}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">
                        {row.company_name ?? "Slettet firma"}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (slettet)
                        </span>
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {[customerSummary(row), row.user_email].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {row.detail && (
                    <p className="whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground">
                      {row.detail}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </SjefenPageShell>
  )
}
