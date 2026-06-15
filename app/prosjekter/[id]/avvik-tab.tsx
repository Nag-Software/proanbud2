"use client"

import * as React from "react"
import Link from "next/link"
import { Download, Plus, Search } from "lucide-react"

import { DeviationListItem } from "@/components/hms/deviation-badges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DEVIATION_STATUSES,
  DEVIATION_STATUS_LABELS,
  DEVIATION_TYPES,
  DEVIATION_TYPE_LABELS,
} from "@/lib/hms/constants"
import type { DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  projectId: string
  deviations: DeviationWithRelations[]
}

export default function AvvikTab({ projectId, deviations }: Props) {
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [typeFilter, setTypeFilter] = React.useState<string>("all")
  const [sourceFilter, setSourceFilter] = React.useState<string>("all")
  const [search, setSearch] = React.useState("")
  const [sortBy, setSortBy] = React.useState<"created_at" | "title">("created_at")

  const filtered = React.useMemo(() => {
    let list = deviations.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false
      if (typeFilter !== "all" && d.type !== typeFilter) return false
      if (sourceFilter !== "all" && (d.source || "manual") !== sourceFilter) return false
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
      if (sortBy === "title") return a.title.localeCompare(b.title, "no")
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return list
  }, [deviations, statusFilter, typeFilter, sourceFilter, search, sortBy])

  const exportUrl = `/api/avvik/export?format=csv&projectId=${projectId}${
    statusFilter !== "all" ? `&status=${statusFilter}` : ""
  }${typeFilter !== "all" ? `&type=${typeFilter}` : ""}${
    sourceFilter !== "all" ? `&source=${sourceFilter}` : ""
  }`

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">Avvik på prosjektet</h3>
          <p className="text-sm text-muted-foreground">
            {filtered.length} av {deviations.length} avvik
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
            <a href={exportUrl} download>
              <Download className="mr-2 size-4" />
              Eksporter
            </a>
          </Button>
          <Button asChild size="sm" className="w-full sm:w-auto">
            <Link href={`/avvik/ny?projectId=${projectId}`}>
              <Plus className="mr-2 size-4" />
              Meld avvik
            </Link>
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk..."
          className="pl-9"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
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
          <SelectTrigger>
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
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kilder</SelectItem>
            <SelectItem value="manual">Manuelt</SelectItem>
            <SelectItem value="checklist">Fra sjekkliste</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as "created_at" | "title")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Nyeste først</SelectItem>
            <SelectItem value="title">Tittel A–Å</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          Ingen avvik registrert på dette prosjektet.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((deviation) => (
            <DeviationListItem key={deviation.id} deviation={deviation} showProject={false} />
          ))}
        </div>
      )}
    </div>
  )
}
