"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyCustomerRow } from "@/lib/platform/company-content"
import { formatDate } from "@/lib/sjefen/format"

const columns: ColumnDef<CompanyCustomerRow>[] = [
  {
    accessorKey: "name",
    header: "Navn",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "email",
    header: "E-post",
    cell: ({ row }) => row.original.email ?? "—",
  },
  {
    accessorKey: "phone",
    header: "Telefon",
    cell: ({ row }) => row.original.phone ?? "—",
  },
  {
    accessorKey: "city",
    header: "Sted",
    cell: ({ row }) => row.original.city ?? "—",
  },
  {
    accessorKey: "org_number",
    header: "Org.nr",
    cell: ({ row }) => row.original.org_number ?? "—",
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function CompanyCustomersClient({ customers }: { customers: CompanyCustomerRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kunder ({customers.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={customers}
          searchColumn="name"
          searchPlaceholder="Søk kunde..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-muted-foreground">
                {[row.email, row.phone].filter(Boolean).join(" · ") || "Ingen kontaktinfo"}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
