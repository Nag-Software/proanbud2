"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  FileText,
  Loader2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"
import { toast } from "sonner"

import {
  updateCompanyHmsAction,
  type HmsChecklistStats,
  type HmsDeviationBreakdown,
  type HmsProjectHealth,
} from "@/app/hms/actions"
import { DeviationListItem } from "@/components/hms/deviation-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { reportClientError } from "@/lib/errors/client"
import { DEVIATION_TYPE_LABELS, type DeviationType } from "@/lib/hms/constants"
import type { DeviationStats, DeviationWithRelations } from "@/lib/hms/types"
import { cn } from "@/lib/utils"

type Props = {
  isAdmin: boolean
  stats: DeviationStats
  deviationBreakdown: HmsDeviationBreakdown
  checklistStats: HmsChecklistStats
  projectHealth: HmsProjectHealth[]
  openDeviations: DeviationWithRelations[]
  handbookContent: string
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon: React.ReactNode
  tone?: "default" | "warning" | "success"
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            tone === "warning" && "bg-amber-500/10 text-amber-600",
            tone === "success" && "bg-emerald-500/10 text-emerald-600",
            tone === "default" && "bg-muted text-muted-foreground"
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function HmsPageClient({
  isAdmin,
  stats,
  deviationBreakdown,
  checklistStats,
  projectHealth,
  openDeviations,
  handbookContent,
}: Props) {
  const [content, setContent] = React.useState(handbookContent)
  const [busy, setBusy] = React.useState(false)

  async function handleSaveHandbook() {
    setBusy(true)
    try {
      await updateCompanyHmsAction({ handbookContent: content })
      toast.success("HMS-håndbok lagret")
    } catch (err) {
      reportClientError(err, { context: { action: "Lagre HMS-håndbok" } })
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre")
    } finally {
      setBusy(false)
    }
  }

  const openTypeEntries = (Object.keys(DEVIATION_TYPE_LABELS) as DeviationType[]).map((type) => ({
    type,
    label: DEVIATION_TYPE_LABELS[type],
    count: deviationBreakdown.openByType[type] || 0,
  }))
  const maxTypeCount = Math.max(1, ...openTypeEntries.map((e) => e.count))

  return (
    <div className="space-y-6">
      {/* Purpose header */}
      <div className="rounded-xl border bg-muted/30 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">HMS & Kvalitetssikring</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Samlet oversikt over helse, miljø og sikkerhet for hele bedriften. Følg opp avvik
              (RUH, HMS og KS), sjekk fremdrift på kvalitetssikring i prosjektene, og hold
              HMS-håndboken oppdatert — alt på ett sted.
            </p>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Åpne avvik"
          value={stats.openCount}
          hint={deviationBreakdown.overdueOpen > 0 ? `${deviationBreakdown.overdueOpen} over 30 dager` : "Ingen forfalte"}
          icon={<AlertTriangle className="size-4" />}
          tone={deviationBreakdown.overdueOpen > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="RUH siste 30 dager"
          value={stats.ruhLast30Days}
          hint="Rapporterte uønskede hendelser"
          icon={<TrendingUp className="size-4" />}
        />
        <KpiCard
          label="Lukket totalt"
          value={stats.closedCount}
          hint={
            deviationBreakdown.avgClosureDays != null
              ? `Snitt ${deviationBreakdown.avgClosureDays} dager å lukke`
              : `${deviationBreakdown.closedLast30Days} siste 30 dager`
          }
          icon={<ShieldCheck className="size-4" />}
          tone="success"
        />
        <KpiCard
          label="KS-utfylling"
          value={`${checklistStats.fillPercent}%`}
          hint={`${checklistStats.itemsAnswered} av ${checklistStats.itemsTotal} punkter besvart`}
          icon={<ClipboardCheck className="size-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Open deviations */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Åpne avvik</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" asChild>
              <Link href="/avvik">
                Se alle <ArrowRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {openDeviations.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Ingen åpne avvik. Bra jobba! 🎉
              </div>
            ) : (
              openDeviations.map((d) => <DeviationListItem key={d.id} deviation={d} />)
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Open deviations by type */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Åpne avvik per type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {deviationBreakdown.open === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen åpne avvik.</p>
              ) : (
                openTypeEntries.map((entry) => (
                  <div key={entry.type} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{entry.label}</span>
                      <span className="font-medium tabular-nums">{entry.count}</span>
                    </div>
                    <Progress value={(entry.count / maxTypeCount) * 100} className="h-1.5" />
                  </div>
                ))
              )}
              {deviationBreakdown.fromChecklist > 0 ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  {deviationBreakdown.fromChecklist} avvik kommer fra KS-sjekklister
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Checklist status */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Kvalitetssikring</CardTitle>
              <Button variant="link" size="sm" className="h-auto p-0" asChild>
                <Link href="/min-bedrift/ks">
                  KS-maler <ArrowRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Fullførte sjekklister</span>
                  <span className="font-medium tabular-nums">
                    {checklistStats.completed} / {checklistStats.total}
                  </span>
                </div>
                <Progress value={checklistStats.completionPercent} className="mt-1 h-1.5" />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-lg font-semibold tabular-nums">{checklistStats.notStarted}</p>
                  <p className="text-[11px] text-muted-foreground">Ikke startet</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-lg font-semibold tabular-nums">{checklistStats.inProgress}</p>
                  <p className="text-[11px] text-muted-foreground">Pågår</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-lg font-semibold tabular-nums">{checklistStats.completed}</p>
                  <p className="text-[11px] text-muted-foreground">Fullført</p>
                </div>
              </div>
              {checklistStats.itemsNotOk > 0 ? (
                <p className="text-xs text-amber-600">
                  {checklistStats.itemsNotOk} kontrollpunkt{checklistStats.itemsNotOk !== 1 ? "er" : ""} merket «ikke ok»
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Per-project HMS health */}
      {projectHealth.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">HMS-status per prosjekt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projectHealth.map((project) => {
              const fillPercent =
                project.itemsTotal > 0
                  ? Math.round((project.itemsAnswered / project.itemsTotal) * 100)
                  : null
              return (
                <Link
                  key={project.projectId}
                  href={`/prosjekter/${project.projectId}?tab=avvik`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{project.projectName}</span>
                  {project.openDeviations > 0 ? (
                    <Badge variant="destructive">{project.openDeviations} åpne avvik</Badge>
                  ) : (
                    <Badge variant="secondary">Ingen åpne avvik</Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {project.checklistTotal === 0
                      ? "Ingen sjekklister"
                      : `KS ${fillPercent}% utfylt`}
                  </span>
                </Link>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* HMS handbook */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" />
            HMS-håndbok
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Bedriftens rutiner, kontaktpersoner og viktige HMS-regler. Tilgjengelig for alle
            ansatte.
          </p>
          {isAdmin ? (
            <>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                placeholder="Skriv inn HMS-rutiner, kontaktpersoner, viktige regler..."
              />
              <Button onClick={handleSaveHandbook} disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Lagre håndbok
              </Button>
            </>
          ) : (
            <div className="whitespace-pre-wrap text-sm text-muted-foreground">
              {content || "Ingen HMS-håndbok er lagt inn ennå."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
