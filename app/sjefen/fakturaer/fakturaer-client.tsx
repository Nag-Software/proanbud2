"use client"

import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { invoiceStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, formatNok, invoiceStatusLabels } from "@/lib/sjefen/format"
import type { SjefenContractRow } from "@/lib/sjefen/types"

const columns: ColumnDef<SjefenContractRow>[] = [
  {
    accessorKey: "title",
    header: "Kontrakt",
  },
  {
    accessorKey: "company_name",
    header: "Firma",
    cell: ({ row }) => (
      <Link href={`/sjefen/firmaer/${row.original.company_id}`} className="hover:underline">
        {row.original.company_name}
      </Link>
    ),
  },
  {
    accessorKey: "amount_nok",
    header: "Beløp",
    cell: ({ row }) => formatNok(row.original.amount_nok),
  },
  {
    accessorKey: "invoice_status",
    header: "Fakturastatus",
    cell: ({ row }) => (
      <StatusBadge
        label={invoiceStatusLabels[row.original.invoice_status] ?? row.original.invoice_status}
        variant={invoiceStatusVariant(row.original.invoice_status)}
      />
    ),
  },
  {
    accessorKey: "status",
    header: "Kontrakt",
    cell: ({ row }) => row.original.status,
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function FakturaerClient({ invoices }: { invoices: SjefenContractRow[] }) {
  return (
    <SjefenPageShell segments={["Sjefen", "Fakturaer"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Fakturaer fra kontrakter
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Fakturaer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoices.length} kontrakter med fakturastatus.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fakturaoversikt</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={invoices}
              searchColumn="title"
              searchPlaceholder="Søk faktura..."
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
