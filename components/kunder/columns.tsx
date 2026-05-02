"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Customer } from "./schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Building2, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export const columns: ColumnDef<Customer>[] = [
  {
    accessorKey: "name",
    header: "Navn",
    cell: ({ row }) => {
      const type = row.original.type
      return (
        <div className="flex items-center gap-2">
          {type === "bedrift" ? (
            <Building2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <User className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{row.getValue("name")}</span>
        </div>
      )
    },
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => {
      const type = row.getValue("type") as string
      return (
        <Badge variant={type === "bedrift" ? "default" : "secondary"}>
          {type === "bedrift" ? "Bedrift" : "Privatperson"}
        </Badge>
      )
    },
  },
  {
    accessorKey: "email",
    header: "E-post",
  },
  {
    accessorKey: "phone",
    header: "Telefon",
  },
  {
    accessorKey: "activeProjects",
    header: () => <div className="text-right">Pågående prosjekter</div>,
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("activeProjects"))
      return <div className="text-right font-medium">{amount}</div>
    },
  },
  {
    accessorKey: "syncStatus",
    header: "Tripletex",
    cell: ({ row }) => {
      const value = row.original.syncStatus || "none"

      if (value === "synced") {
        return <Badge variant="outline">Synced</Badge>
      }

      if (value === "syncing") {
        return <Badge variant="secondary">Syncer...</Badge>
      }

      if (value === "attention") {
        return <Badge variant="destructive">Krever handling</Badge>
      }

      return <Badge variant="secondary">Ikke synkronisert</Badge>
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const customer = row.original
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Åpne meny</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Handlinger</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(customer.email)}
            >
              Kopier e-post
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(customer.phone)}
            >
              Kopier telefon
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Se detaljer</DropdownMenuItem>
            <DropdownMenuItem>Opprett tilbud</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]
