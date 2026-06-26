"use client"

import { type ReactNode, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  RotateCcw,
  Search,
} from "lucide-react"
import { toast } from "sonner"

import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDateTime, formatRelative } from "@/lib/sjefen/format"
import type { ErrorGroup, ErrorLogDashboard } from "@/lib/platform/error-logs"
import { reopenErrorGroupAction, resolveAllErrorsAction, resolveErrorGroupAction } from "./actions"

const LEVEL_LABEL: Record<string, string> = { fatal: "Fatal", error: "Feil", warning: "Advarsel" }
const SOURCE_LABEL: Record<string, string> = {
  client: "Klient",
  server: "Server",
  api: "API",
  action: "Handling",
  worker: "Bakgrunn",
}

function levelClasses(level: string) {
  if (level === "fatal") return "bg-destructive/15 text-destructive border-destructive/30"
  if (level === "warning") return "bg-amber-500/15 text-amber-600 border-amber-500/30"
  return "bg-destructive/10 text-destructive/90 border-destructive/20"
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  tone?: "danger" | "default"
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={
            "flex size-9 items-center justify-center rounded-lg " +
            (tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")
          }
        >
          {icon}
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ErrorGroupCard({ group }: { group: ErrorGroup }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const resolve = () => {
    startTransition(async () => {
      try {
        await resolveErrorGroupAction(group.fingerprint)
        toast.success("Markert som løst")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kunne ikke markere som løst")
      }
    })
  }

  const reopen = () => {
    startTransition(async () => {
      try {
        await reopenErrorGroupAction(group.fingerprint)
        toast.success("Gjenåpnet")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kunne ikke gjenåpne")
      }
    })
  }

  return (
    <Card className={group.resolved ? "opacity-70" : undefined}>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/40"
          aria-expanded={open}
        >
          <span className="mt-0.5 text-muted-foreground">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={levelClasses(group.level)}>
                {LEVEL_LABEL[group.level] ?? group.level}
              </Badge>
              <Badge variant="secondary">{SOURCE_LABEL[group.source] ?? group.source}</Badge>
              {group.resolved && (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                  Løst
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {group.count} {group.count === 1 ? "forekomst" : "forekomster"} · sist {formatRelative(group.lastSeen)}
              </span>
            </div>
            <p className="truncate font-medium text-foreground" title={group.message}>
              {group.message}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {group.routes.length > 0 && (
                <span className="font-mono">{group.routes.slice(0, 3).join(", ")}{group.routes.length > 3 ? " …" : ""}</span>
              )}
              {group.affectedUsers > 0 && <span>{group.affectedUsers} bruker(e)</span>}
              {group.affectedCompanies > 0 && <span>{group.affectedCompanies} firma(er)</span>}
            </div>
          </div>
        </button>

        {open && (
          <div className="border-t bg-muted/20 p-4">
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              {group.resolved ? (
                <Button size="sm" variant="outline" onClick={reopen} disabled={isPending} className="gap-1.5">
                  <RotateCcw className="size-3.5" />
                  Gjenåpne
                </Button>
              ) : (
                <Button size="sm" onClick={resolve} disabled={isPending} className="gap-1.5">
                  <CheckCircle2 className="size-3.5" />
                  {isPending ? "Lagrer…" : "Marker som løst"}
                </Button>
              )}
            </div>

            {group.occurrences[0]?.stack && (
              <pre className="mb-3 max-h-48 overflow-auto rounded-md border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
                {group.occurrences[0].stack}
              </pre>
            )}

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Siste forekomster
              </div>
              <div className="overflow-hidden rounded-md border">
                {group.occurrences.map((occ) => (
                  <div
                    key={occ.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b bg-card px-3 py-2 text-xs last:border-b-0"
                  >
                    <span className="font-mono text-muted-foreground">{formatDateTime(occ.created_at)}</span>
                    {occ.route && <span className="font-mono">{occ.route}</span>}
                    {occ.status_code && <span className="text-muted-foreground">HTTP {occ.status_code}</span>}
                    {occ.user_email && <span className="text-muted-foreground">{occ.user_email}</span>}
                    {occ.company_name && <span className="text-muted-foreground">{occ.company_name}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function FeilClient({
  dashboard,
  includeResolved,
}: {
  dashboard: ErrorLogDashboard
  includeResolved: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState("all")
  const [source, setSource] = useState("all")
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return dashboard.groups.filter((g) => {
      if (level !== "all" && g.level !== level) return false
      if (source !== "all" && g.source !== source) return false
      if (q && !g.message.toLowerCase().includes(q) && !g.routes.some((r) => r.toLowerCase().includes(q)))
        return false
      return true
    })
  }, [dashboard.groups, search, level, source])

  const resolveAll = () => {
    startTransition(async () => {
      try {
        await resolveAllErrorsAction()
        toast.success("Alle feil markert som løst")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kunne ikke markere alle")
      }
    })
  }

  return (
    <SjefenPageShell segments={["Sjefen", "Feillogg"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Overvåkning
            </p>
            <h1 className="text-2xl font-semibold text-foreground">Feillogg</h1>
            <p className="text-sm text-muted-foreground">
              Feil brukere har opplevd – fra klient, API, server-handlinger og bakgrunnsjobber.
            </p>
          </div>
          {dashboard.summary.unresolvedOccurrences > 0 && (
            <Button variant="outline" onClick={resolveAll} disabled={isPending} className="gap-1.5">
              <CheckCircle2 className="size-4" />
              Marker alle som løst
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<CircleDot className="size-5" />}
            label="Aktive feilgrupper"
            value={dashboard.summary.unresolvedGroups}
            tone={dashboard.summary.unresolvedGroups > 0 ? "danger" : "default"}
          />
          <StatCard
            icon={<AlertTriangle className="size-5" />}
            label="Uløste forekomster"
            value={dashboard.summary.unresolvedOccurrences}
            tone={dashboard.summary.unresolvedOccurrences > 0 ? "danger" : "default"}
          />
          <StatCard
            icon={<AlertOctagon className="size-5" />}
            label="Fatale (uløst)"
            value={dashboard.summary.fatalUnresolved}
            tone={dashboard.summary.fatalUnresolved > 0 ? "danger" : "default"}
          />
          <StatCard icon={<CircleDot className="size-5" />} label="Siste 24 t" value={dashboard.summary.last24h} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Søk i feil"
              placeholder="Søk i melding eller rute…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-[140px]" aria-label="Filtrer på nivå">
              <SelectValue placeholder="Nivå" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle nivåer</SelectItem>
              <SelectItem value="fatal">Fatal</SelectItem>
              <SelectItem value="error">Feil</SelectItem>
              <SelectItem value="warning">Advarsel</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[150px]" aria-label="Filtrer på kilde">
              <SelectValue placeholder="Kilde" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kilder</SelectItem>
              <SelectItem value="client">Klient</SelectItem>
              <SelectItem value="api">API</SelectItem>
              <SelectItem value="action">Handling</SelectItem>
              <SelectItem value="server">Server</SelectItem>
              <SelectItem value="worker">Bakgrunn</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={includeResolved ? "default" : "outline"}
            onClick={() => router.push(includeResolved ? "/sjefen/feil" : "/sjefen/feil?vis=alle")}
          >
            {includeResolved ? "Viser alle" : "Vis løste"}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <CheckCircle2 className="size-8 text-emerald-500" />
              <p className="font-medium text-foreground">Ingen feil å vise</p>
              <p className="text-sm text-muted-foreground">
                {includeResolved
                  ? "Ingen feil matcher filteret."
                  : "Ingen aktive feil akkurat nå. Godt jobbet!"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((group) => (
              <ErrorGroupCard key={group.fingerprint} group={group} />
            ))}
          </div>
        )}
      </div>
    </SjefenPageShell>
  )
}
