"use client"

import { ColumnDef, Row } from "@tanstack/react-table"
import { useRouter } from "next/navigation"
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
import { deleteCustomerAction } from "@/app/kunder/actions"
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"
import { useConfirm } from "@/components/ui/confirm-dialog"

type CustomerColumnHandlers = {
  onViewDetails: (customer: Customer) => void
  /** Show the Tripletex sync-status column. Only when Tripletex is connected. */
  showTripletex?: boolean
}

export function CustomerRowActions({
  customer,
  onViewDetails,
}: {
  customer: Customer
  onViewDetails: (customer: Customer) => void
}) {
  const router = useRouter()
  const confirm = useConfirm()

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Slette ${customer.name}?`,
      description: "Kunden og tilknyttet historikk fjernes. Dette kan ikke angres.",
      confirmText: "Slett kunde",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!ok) return

    try {
      await deleteCustomerAction(customer.id)
      toast.success("Kunde slettet")
      router.refresh()
    } catch (error) {
      reportClientError(error, { context: { action: "delete-customer", customerId: customer.id } })
      toast.error("Kunne ikke slette kunde")
      console.error(error)
    }
  }

  return (
    <div data-prevent-row-click onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="sr-only">Åpne meny</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onViewDetails(customer)}>
            Se detaljer
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
            Opprett tilbud
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Handlinger</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              void navigator.clipboard.writeText(customer.email)
            }}
          >
            Kopier e-post
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              void navigator.clipboard.writeText(customer.phone)
            }}
          >
            Kopier telefon
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={(event) => {
              event.preventDefault()
              void handleDelete()
            }}
          >
            Fjern kunde
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function createCustomerColumns({
  onViewDetails,
  showTripletex = false,
}: CustomerColumnHandlers): ColumnDef<Customer>[] {
  return [
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
  ...(showTripletex
    ? [
        {
          accessorKey: "syncStatus",
          header: "Tripletex",
          cell: ({ row }: { row: Row<Customer> }) => {
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
        } satisfies ColumnDef<Customer>,
      ]
    : []),
  {
    id: "actions",
    cell: ({ row }) => (
      <CustomerRowActions
        customer={row.original}
        onViewDetails={onViewDetails}
      />
    ),
  },
  ]
}
