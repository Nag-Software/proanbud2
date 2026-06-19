"use client"

import Link from "next/link"
import { MoreVertical } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { offerStatusConfigByValue, totalOfferStatusBars, type Quota } from "@/components/tilbud/columns"

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
}

export function OfferCard({ offer }: OfferCardProps) {
  const statusConfig = offerStatusConfigByValue[offer.status]

  return (
    <div className="group relative flex aspect-[4/4] flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25 hover:bg-card/95">
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground opacity-100 transition-opacity hover:bg-muted/80 hover:text-foreground md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.preventDefault()}
            >
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Tilbudshandlinger</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/tilbud/${offer.id}`}>Rediger</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/tilbud/${offer.id}`}>Forhåndsvis</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/tilbud/${offer.id}`}>Åpne tilbud</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/tilbud/${offer.id}`} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col p-3.5 pr-10">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-snug text-foreground group-hover:text-primary">
              {offer.title}
            </p>
            <p className="mt-2 line-clamp-7 text-xs leading-relaxed text-muted-foreground">
              {offer.description}
            </p>
          </div>

          <div className="mt-auto min-w-0 space-y-0.5 pt-3 text-xs text-muted-foreground">
            <p className="truncate tabular-nums">{offer.created}</p>
            <p className="truncate text-lg font-semibold tabular-nums text-foreground">
              {formatNOK(offer.amount)}
            </p>
          </div>
        </div>

        <div className="w-full border-t border-border/50 bg-muted/25 px-3.5 py-2.5">
          <div className="flex w-full gap-1">
            {Array.from({ length: totalOfferStatusBars }).map((_, index) => {
              const isFilled = index < statusConfig.filledBars

              return (
                <span
                  key={`${offer.id}-bar-${index}`}
                  className={cn(
                    "h-1 flex-1 rounded-full bg-muted",
                    isFilled && statusConfig.fillClass
                  )}
                />
              )
            })}
          </div>
          <p className="mt-1.5 w-full text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {statusConfig.label}
          </p>
        </div>
      </Link>
    </div>
  )
}
