"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { invoiceStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyContractRow } from "@/lib/platform/company-content"
import {
  contractStatusLabels,
  formatDate,
  formatNok,
  invoiceStatusLabels,
} from "@/lib/sjefen/format"

function contractStatusVariant(status: string) {
  switch (status) {
    case "completed":
      return "success" as const
    case "sent":
    case "delivered":
      return "default" as const
    case "declined":
    case "voided":
    case "error":
      return "danger" as const
    default:
      return "muted" as const
  }
}

const columns: ColumnDef<CompanyContractRow>[] = [
  {
    accessorKey: "title",
    header: "Tittel",
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: "amount_nok",
    header: "Beløp",
    cell: ({ row }) =>
      row.original.amount_nok != null ? formatNok(row.original.amount_nok) : "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={contractStatusLabels[row.original.status] ?? row.original.status}
        variant={contractStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "invoice_status",
    header: "Faktura",
    cell: ({ row }) => (
      <StatusBadge
        label={invoiceStatusLabels[row.original.invoice_status] ?? row.original.invoice_status}
        variant={invoiceStatusVariant(row.original.invoice_status)}
      />
    ),
  },
  {
    accessorKey: "signed_at",
    header: "Signert",
    cell: ({ row }) => formatDate(row.original.signed_at),
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function CompanyContractsClient({ contracts }: { contracts: CompanyContractRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kontrakter ({contracts.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={contracts}
          searchColumn="title"
          searchPlaceholder="Søk kontrakt..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.title}</p>
                <StatusBadge
                  label={contractStatusLabels[row.status] ?? row.status}
                  variant={contractStatusVariant(row.status)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {row.amount_nok != null ? formatNok(row.amount_nok) : "—"} · Opprettet{" "}
                {formatDate(row.created_at)}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
