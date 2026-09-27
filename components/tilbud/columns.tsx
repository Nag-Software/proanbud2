"use client"

import { ColumnDef } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { MoreHorizontalIcon } from "lucide-react"
import Link from "next/link"

// This type is used to define the shape of our data.
// You can use a Zod schema here if you want.
export type Quota = {
  id: string
  amount: number
  status: "draft" | "sent" | "accepted" | "rejected"
  email: string
  project: string
  description: string
  customer: string
  created: string
  settings: string
}

type StatusConfig = {
  label: string
  filledBars: number
  fillClass: string
  /** Samme merke som tilbudslisten, tilbudsdetaljen og dashbordet (theme-badge-status-* i globals.css). */
  badgeClass: string
  /**
   * Prikk inne i merket. Merket alene skiller nesten ikke statusene: outline-
   * varianten til Badge overstyrer tekst- og kantfargen fra theme-badge-status-*,
   * så bare en svak bakgrunnstone blir igjen. Prikken bærer fargen.
   */
  dotClass: string
}

export const offerStatusConfigByValue: Record<Quota["status"], StatusConfig> = {
  draft: {
    label: "Utkast",
    filledBars: 0,
    fillClass: "bg-gray-300",
    badgeClass: "theme-badge-status-draft",
    dotClass: "bg-[var(--tone-neutral)]",
  },
  sent: {
    label: "Sendt",
    filledBars: 1,
    fillClass: "bg-rose-500",
    badgeClass: "theme-badge-status-sent",
    dotClass: "bg-[var(--tone-warning)]",
  },
  accepted: {
    label: "Godkjent",
    filledBars: 3,
    fillClass: "bg-emerald-500",
    badgeClass: "theme-badge-status-accepted",
    dotClass: "bg-[var(--tone-success)]",
  },
  rejected: {
    label: "Avvist",
    filledBars: 2,
    fillClass: "bg-slate-400",
    badgeClass: "theme-badge-status-rejected",
    dotClass: "bg-[var(--tone-danger)]",
  },
}

export const totalOfferStatusBars = 3

export const columns: ColumnDef<Quota>[] = [
  {
    accessorKey: "customer",
    header: "Kunde",
  },
  {
    accessorKey: "project",
    header: "Prosjekt",
    cell: ({ row }) => (
      <Link
        href={`/tilbud/${row.original.id}`}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.project}
      </Link>
    ),
  },
  {
    accessorKey: "description",
    header: "Beskrivelse",
  },
  {
    accessorKey: "created",
    header: "Dato opprettet",
  },
  {
    accessorKey: "amount",
    header: "Beløp",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status
      const config = offerStatusConfigByValue[status]

      return (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {Array.from({ length: totalOfferStatusBars }).map((_, index) => {
              const isFilled = index < config.filledBars

              return (
                <span
                  key={`${row.id}-bar-${index}`}
                  className={cn(
                    "h-2.5 w-5 rounded-sm bg-muted",
                    isFilled && config.fillClass
                  )}
                />
              )
            })}
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {config.label}
          </span>
        </div>
      )
    },
  },
  {
    id: "actions",
    header: "Handlinger",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" type="button">
            <MoreHorizontalIcon />
            <span className="sr-only">Handlinger</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/tilbud/${row.original.id}`}>Rediger</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/tilbud/${row.original.id}`}>Forhåndsvis</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/tilbud/${row.original.id}`}>Åpne tilbud</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }
]
