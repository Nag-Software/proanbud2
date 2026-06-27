"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Gauge, Settings2, Sparkles } from "lucide-react"

import { reportClientError } from "@/lib/errors/client"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { QueueCardView } from "@/components/selger/queue-card"
import { CallDrawer } from "@/app/selger/_components/call-drawer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { HealthSignal } from "@/lib/selger/engine-health"
import type { OutreachMetrics } from "@/lib/outreach/metrics"
import type { CallCard, QueueCard, QueueCounts } from "@/lib/selger/queue"

type TodayClientProps = {
  standup: string
  metrics: OutreachMetrics
  health: HealthSignal[]
  initialCards: QueueCard[]
  counts: QueueCounts
}

type FilterKey = "all" | "call" | "approve" | "trial"

const LEVEL_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  alarm: "bg-red-500",
}

export function TodayClient({ standup, metrics, health, initialCards }: TodayClientProps) {
  const router = useRouter()
  const [cards, setCards] = useState(initialCards)
  const [filter, setFilter] = useState<FilterKey>("all")
  const [callTarget, setCallTarget] = useState<CallCard | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [liveStandup, setLiveStandup] = useState(standup)

  // Upgrade the instant heuristic standup to the AI version without blocking render.
  useEffect(() => {
    let active = true
    fetch("/api/selger/standup")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.standup) setLiveStandup(data.standup as string)
      })
      .catch((error) => {
        // Non-fatal: the deterministic standup is already shown. Log for visibility.
        console.error("[TodayClient] kunne ikke oppgradere standup", error)
        reportClientError(error, { level: "warning", context: { action: "oppgradere standup" } })
      })
    return () => {
      active = false
    }
  }, [])

  const remove = (id: string) => setCards((prev) => prev.filter((c) => c.id !== id))

  const openCall = (card: CallCard) => {
    setCallTarget(card)
    setDrawerOpen(true)
  }

  const live = useMemo(() => {
    return {
      all: cards.length,
      call: cards.filter((c) => c.kind === "call").length,
      approve: cards.filter((c) => c.kind === "approve").length,
      trial: cards.filter((c) => c.kind === "trial").length,
    }
  }, [cards])

  const filtered = useMemo(
    () => (filter === "all" ? cards : cards.filter((c) => c.kind === filter)),
    [cards, filter]
  )

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "Alle", count: live.all },
    { key: "call", label: "Ring", count: live.call },
    { key: "approve", label: "Godkjenn", count: live.approve },
    { key: "trial", label: "Trials", count: live.trial },
  ]

  return (
    <SelgerPageShell segments={["Selger", "I dag"]}>
      <div className="mx-auto w-full max-w-3xl space-y-5 pt-2">
        {/* AI standup */}
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-[15px] leading-relaxed font-medium">{liveStandup}</p>
        </div>

        {/* Engine health strip */}
        <button
          onClick={() => router.push("/selger/motor")}
          className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3.5" /> Motor
          </span>
          {health.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-sm" title={s.hint}>
              <span className={cn("size-2 rounded-full", LEVEL_DOT[s.level])} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium">{s.value}</span>
            </span>
          ))}
          <Settings2 className="ml-auto size-3.5 text-muted-foreground" />
        </button>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                filter === f.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
              {f.count > 0 ? <span className="ml-1.5 opacity-70">{f.count}</span> : null}
            </button>
          ))}
        </div>

        {/* Card stack */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
            <CheckCircle2 className="size-8 text-emerald-500" />
            <div>
              <p className="font-medium">Alt under kontroll</p>
              <p className="text-sm text-muted-foreground">
                Maskinen jobber i bakgrunnen. {metrics.sentToday} e-poster sendt i dag.
              </p>
            </div>
            <Button variant="outline" onClick={() => router.push("/selger/motor")}>
              Se motoren
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((card) => (
              <QueueCardView key={`${card.kind}-${card.id}`} card={card} onRemove={remove} onOpenCall={openCall} />
            ))}
          </div>
        )}
      </div>

      <CallDrawer
        card={callTarget}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onResolved={remove}
      />
    </SelgerPageShell>
  )
}
