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
}

const statusConfigByValue: Record<Quota["status"], StatusConfig> = {
  draft: {
    label: "Utkast",
    filledBars: 0,
    fillClass: "bg-gray-300",
  },
  sent: {
    label: "Sendt",
    filledBars: 1,
    fillClass: "bg-rose-500",
  },
  accepted: {
    label: "Godkjent",
    filledBars: 3,
    fillClass: "bg-emerald-500",
  },
  rejected: {
    label: "Avvist",
    filledBars: 2,
    fillClass: "bg-slate-400",
  },
}

const totalBars = 3

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
      const config = statusConfigByValue[status]

      return (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {Array.from({ length: totalBars }).map((_, index) => {
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
            <Link href={`/tilbud/${row.original.id}`}>Send kontrakt</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }
]
