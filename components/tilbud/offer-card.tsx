"use client"

import Link from "next/link"
import { ArrowRight, CalendarDays } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { offerStatusConfigByValue, type Quota } from "@/components/tilbud/columns"

export type OfferCardData = {
  id: string
  title: string
  description: string
  created: string
  amount: number
  status: Quota["status"]
}

function formatNOK(amount: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(amount)
}

type OfferCardProps = {
  offer: OfferCardData
  /** Read-only mode for users who may view but not edit offers (e.g. workers). */
  readOnly?: boolean
}

export function OfferCard({ offer, readOnly = false }: OfferCardProps) {
  const statusConfig = offerStatusConfigByValue[offer.status]

  // Kortet får naturlig høyde. Det var låst til et kvadrat før, og da la en
  // lang beskrivelse seg oppå dato, beløp og status.
  const body = (
    <>
      <div className="flex flex-1 flex-col items-start p-3.5">
        <Badge variant="outline" className={cn("font-medium", statusConfig.badgeClass)}>
          <span className={cn("size-1.5 rounded-full", statusConfig.dotClass)} aria-hidden />
          {statusConfig.label}
        </Badge>

        {/* Beløpet er det man leter etter under Økonomi. Et avvist tilbud er
            ikke penger på vei inn, så der dempes det. */}
        <p
          className={cn(
            "mt-4 whitespace-nowrap text-2xl font-bold leading-tight tracking-tight tabular-nums",
            offer.status === "rejected" ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {formatNOK(offer.amount)}
        </p>

        <p className="mt-2 w-full truncate text-sm font-semibold leading-snug text-foreground">
          {offer.title}
        </p>
        <p className="mt-1 line-clamp-2 w-full text-[13px] leading-normal text-muted-foreground">
          {offer.description || "Ingen beskrivelse"}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3.5 py-2.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {offer.created && (
            <>
              <CalendarDays className="size-3.5" aria-hidden />
              {offer.created}
            </>
          )}
        </span>
        {!readOnly && (
          <span className="inline-flex items-center gap-1 font-semibold text-foreground">
            Åpne
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        )}
      </div>
    </>
  )

  const cardClassName = "group flex h-full flex-col overflow-hidden rounded-lg border border-border/60 bg-card"

  if (readOnly) {
    return <div className={cardClassName}>{body}</div>
  }

  return (
    <Link
      href={`/tilbud/${offer.id}`}
      className={cn(
        cardClassName,
        "outline-none transition-colors hover:border-primary/25 hover:bg-card/95 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
      )}
    >
      {body}
    </Link>
  )
}
