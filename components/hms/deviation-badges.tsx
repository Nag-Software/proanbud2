"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  DEVIATION_STATUS_LABELS,
  DEVIATION_TYPE_LABELS,
  type DeviationStatus,
  type DeviationType,
} from "@/lib/hms/constants"
import type { DeviationWithRelations } from "@/lib/hms/types"
import { cn } from "@/lib/utils"

export function DeviationStatusBadge({ status }: { status: DeviationStatus }) {
  return (
    <Badge variant={status === "open" ? "destructive" : "secondary"}>
      {DEVIATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function DeviationTypeBadge({ type }: { type: DeviationType }) {
  return <Badge variant="outline">{DEVIATION_TYPE_LABELS[type]}</Badge>
}

export function DeviationListItem({
  deviation,
  showProject = true,
}: {
  deviation: DeviationWithRelations
  showProject?: boolean
}) {
  return (
    <Link
      href={`/avvik/${deviation.id}`}
      className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {deviation.reference_number}
            </span>
            <DeviationTypeBadge type={deviation.type} />
            <DeviationStatusBadge status={deviation.status} />
          </div>
          <p className="font-medium">{deviation.title}</p>
          {showProject && deviation.projects?.name && (
            <p className="text-sm text-muted-foreground">{deviation.projects.name}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(deviation.created_at).toLocaleDateString("no-NO")}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{deviation.description}</p>
    </Link>
  )
}

export function DeviationStatsCards({
  stats,
}: {
  stats: { openCount: number; closedCount: number; ruhLast30Days: number }
}) {
  const cards = [
    { label: "Åpne", value: stats.openCount },
    { label: "Lukket", value: stats.closedCount },
    { label: "RUH siste 30 dager", value: stats.ruhLast30Days },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className={cn("rounded-lg border p-4")}>
          <p className="text-sm text-muted-foreground">{card.label}</p>
          <p className="text-2xl font-semibold">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
