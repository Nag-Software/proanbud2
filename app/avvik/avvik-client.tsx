"use client"

import * as React from "react"
import Link from "next/link"
import { Download, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DeviationListItem, DeviationStatsCards } from "@/components/hms/deviation-badges"
import {
  DEVIATION_STATUSES,
  DEVIATION_STATUS_LABELS,
  DEVIATION_TYPES,
  DEVIATION_TYPE_LABELS,
  OPEN_DEVIATION_STATUSES,
} from "@/lib/hms/constants"
import type { DeviationStats, DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  deviations: DeviationWithRelations[]
  projects: Array<{ id: string; name: string }>
}

type SortBy = "created_at" | "title" | "status" | "type"

export function AvvikClient({ deviations, projects }: Props) {
  const stats: DeviationStats = React.useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    return {
      openCount: deviations.filter((d) =>
        OPEN_DEVIATION_STATUSES.includes(d.status as "open")
      ).length,
      closedCount: deviations.filter((d) => d.status === "closed").length,
      ruhLast30Days: deviations.filter(
        (d) => d.type === "ruh" && d.created_at >= thirtyDaysAgo
      ).length,
    }
  }, [deviations])

  const [statusFilter, setStatusFilter] = React.useState<string>("open")
  const [typeFilter, setTypeFilter] = React.useState<string>("all")
  const [projectFilter, setProjectFilter] = React.useState<string>("all")
  const [sourceFilter, setSourceFilter] = React.useState<string>("all")
  const [search, setSearch] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [sortBy, setSortBy] = React.useState<SortBy>("created_at")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")

  const filtered = React.useMemo(() => {
    let list = deviations.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false
      if (typeFilter !== "all" && d.type !== typeFilter) return false
      if (projectFilter !== "all" && d.project_id !== projectFilter) return false
      if (sourceFilter !== "all" && (d.source || "manual") !== sourceFilter) return false
      if (dateFrom && d.created_at < dateFrom) return false
      if (dateTo && d.created_at > `${dateTo}T23:59:59`) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !d.title.toLowerCase().includes(q) &&
          !d.description.toLowerCase().includes(q) &&
          !d.reference_number.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })

    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortBy === "created_at") {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      } else if (sortBy === "title") {
        cmp = a.title.localeCompare(b.title, "no")
      } else if (sortBy === "status") {
        cmp = a.status.localeCompare(b.status)
      } else if (sortBy === "type") {
        cmp = a.type.localeCompare(b.type)
      }
      return sortDir === "asc" ? cmp : -cmp
    })

    return list
  }, [
    deviations,
    statusFilter,
    typeFilter,
    projectFilter,
    sourceFilter,
    search,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
  ])

  function buildExportUrl(format: "csv" | "html") {
    const params = new URLSearchParams()
    params.set("format", format)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (typeFilter !== "all") params.set("type", typeFilter)
    if (projectFilter !== "all") params.set("projectId", projectFilter)
    if (sourceFilter !== "all") params.set("source", sourceFilter)
    if (search) params.set("search", search)
    if (dateFrom) params.set("dateFrom", dateFrom)
    if (dateTo) params.set("dateTo", dateTo)
    return `/api/avvik/export?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Avvik"
        subtitle="Meld og følg opp avvik på prosjektene dine"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
              <a href={buildExportUrl("csv")} download>
                <Download className="mr-2 size-4" />
                Eksporter CSV
              </a>
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
              <a href={buildExportUrl("html")} target="_blank" rel="noreferrer">
                <Download className="mr-2 size-4" />
                Avviksrapport
              </a>
            </Button>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/avvik/ny">
                <Plus className="mr-2 size-4" />
                Meld avvik
              </Link>
            </Button>
          </div>
        }
      />

      <DeviationStatsCards stats={stats} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk i tittel, beskrivelse eller referanse..."
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statuser</SelectItem>
            {DEVIATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {DEVIATION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle typer</SelectItem>
            {DEVIATION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {DEVIATION_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kilder</SelectItem>
            <SelectItem value="manual">Manuelt</SelectItem>
            <SelectItem value="checklist">Fra sjekkliste</SelectItem>
          </SelectContent>
        </Select>

        {projects.length > 1 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle prosjekter</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <DatePicker
          value={dateFrom}
          onChange={setDateFrom}
          placeholder="Fra dato"
          className="flex-1 min-w-32"
        />
        <DatePicker
          value={dateTo}
          onChange={setDateTo}
          placeholder="Til dato"
          className="flex-1 min-w-32"
        />
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="flex-1 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Sorter: Dato</SelectItem>
            <SelectItem value="title">Sorter: Tittel</SelectItem>
            <SelectItem value="status">Sorter: Status</SelectItem>
            <SelectItem value="type">Sorter: Type</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortDir} onValueChange={(v) => setSortDir(v as "asc" | "desc")}>
          <SelectTrigger className="flex-1 min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Synkende</SelectItem>
            <SelectItem value="asc">Stigende</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} avvik {filtered.length !== deviations.length && `(filtrert fra ${deviations.length})`}
      </p>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            Ingen avvik her.{" "}
            <Link href="/avvik/ny" className="text-primary underline">
              Meld avvik
            </Link>
          </div>
        ) : (
          filtered.map((deviation) => (
            <DeviationListItem key={deviation.id} deviation={deviation} />
          ))
        )}
      </div>
    </div>
  )
}
