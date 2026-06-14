"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
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
} from "@/lib/hms/constants"
import type { DeviationStats, DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  deviations: DeviationWithRelations[]
  stats: DeviationStats
  projects: Array<{ id: string; name: string }>
}

export function AvvikClient({ deviations, stats, projects }: Props) {
  const [statusFilter, setStatusFilter] = React.useState<string>("open")
  const [typeFilter, setTypeFilter] = React.useState<string>("all")
  const [projectFilter, setProjectFilter] = React.useState<string>("all")

  const filtered = deviations.filter((d) => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false
    if (typeFilter !== "all" && d.type !== typeFilter) return false
    if (projectFilter !== "all" && d.project_id !== projectFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Avvik"
        subtitle="Meld og følg opp avvik på prosjektene dine"
        actions={
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/avvik/ny">
              <Plus className="mr-2 size-4" />
              Meld avvik
            </Link>
          </Button>
        }
      />

      <DeviationStatsCards stats={stats} />

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            {DEVIATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {DEVIATION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-[140px]">
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

        {projects.length > 1 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
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
