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
      {/* Beskrivelsen er to linjer brødtekst i en liste man skanner. På
          desktop koster den ingenting; på mobil er den en tredjedel av
          radhøyden for noe man uansett leser inne på avviket. */}
      <p className="mt-2 hidden line-clamp-2 text-sm text-muted-foreground sm:block">
        {deviation.description}
      </p>
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
    // Tre stablede fullbreddekort er 340 px på en telefon — nok til at ingen
    // avvik er synlige før du ruller. Tallene er små nok til å stå ved siden
    // av hverandre, så de gjør det på alle bredder.
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {cards.map((card) => (
        <div key={card.label} className={cn("rounded-lg border p-3 sm:p-4")}>
          <p className="text-xl font-semibold tabular-nums sm:hidden">{card.value}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:mt-0 sm:text-sm">
            {card.label}
          </p>
          <p className="hidden text-2xl font-semibold sm:block">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
