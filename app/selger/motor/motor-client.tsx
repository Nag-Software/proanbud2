"use client"

import { useRouter } from "next/navigation"
import {
  Activity,
  BarChart3,
  ChevronDown,
  Download,
  Send,
  Sparkles,
} from "lucide-react"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { HealthSignal } from "@/lib/selger/engine-health"
import type { OutreachMetrics } from "@/lib/outreach/metrics"

const LEVEL_RING: Record<string, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/5",
  warn: "border-amber-500/30 bg-amber-500/5",
  alarm: "border-red-500/30 bg-red-500/5",
}
const LEVEL_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  alarm: "bg-red-500",
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
    </div>
  )
}

export function MotorClient({
  metrics,
  health,
  dailyLimit,
}: {
  metrics: OutreachMetrics
  health: HealthSignal[]
  dailyLimit: number
}) {
  const router = useRouter()
  const nextRun = metrics.nextCronAt
    ? new Date(metrics.nextCronAt).toLocaleString("nb-NO", { weekday: "long", hour: "2-digit", minute: "2-digit" })
    : "—"

  return (
    <SelgerPageShell segments={["Selger", "Motor"]}>
      <div className="mx-auto w-full max-w-3xl space-y-6 pt-2">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Maskinen styrer dette selv</h1>
            <p className="text-sm text-muted-foreground">
              Importerer, skriver, sender og følger opp automatisk. Neste kjøring: {nextRun}.
            </p>
          </div>
        </div>

        {/* Health */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.map((s) => (
            <div key={s.key} className={cn("rounded-xl border p-4", LEVEL_RING[s.level])}>
              <div className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", LEVEL_DOT[s.level])} />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </span>
              </div>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>
            </div>
          ))}
        </div>

        {/* Volume + engagement */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Metric label="Sendt i dag" value={`${metrics.sentToday} / ${dailyLimit}`} />
          <Metric label="Sendt 7 dager" value={metrics.sent7d} />
          <Metric label="Åpningsrate" value={`${(metrics.openRate * 100).toFixed(0)} %`} />
          <Metric label="Klikkrate" value={`${(metrics.clickRate * 100).toFixed(0)} %`} />
          <Metric label="Drivstoff" value={`${metrics.sendableNow} klare`} />
          <Metric label="Prospekter" value={metrics.prospectsTotal} />
          <Metric label="Kontaktet" value={metrics.prospectsContacted} />
          <Metric label="Konverteringer" value={metrics.conversions} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => router.push("/selger/analyse")}>
            <BarChart3 className="size-4" /> Full innsikt
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => router.push("/selger/aktivitet")}>
            <Activity className="size-4" /> Aktivitetslogg
          </Button>
        </div>

        {/* Manual override */}
        <Collapsible>
          <Card>
            <CardContent className="pt-5">
              <CollapsibleTrigger className="flex w-full items-center justify-between">
                <span className="text-sm font-medium">Manuell override</span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-4">
                <p className="text-sm text-muted-foreground">
                  Maskinen gjør dette automatisk hver virkedag. Bruk knappene under bare hvis du vil
                  kjøre noe manuelt.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="gap-2" onClick={() => router.push("/selger/leads")}>
                    <Download className="size-4" /> Importer leads
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => router.push("/selger/leads")}>
                    <Send className="size-4" /> Kjør utsending
                  </Button>
                </div>
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      </div>
    </SelgerPageShell>
  )
}
