"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyMessageRow } from "@/lib/platform/company-content"
import { formatDateTime } from "@/lib/sjefen/format"

const columns: ColumnDef<CompanyMessageRow>[] = [
  {
    accessorKey: "customer_name",
    header: "Kunde",
    cell: ({ row }) => <span className="font-medium">{row.original.customer_name}</span>,
  },
  {
    accessorKey: "content",
    header: "Melding",
    cell: ({ row }) => (
      <span className="line-clamp-2 max-w-[420px] whitespace-normal text-sm">
        {row.original.content}
      </span>
    ),
  },
  {
    accessorKey: "sender_type",
    header: "Avsender",
    cell: ({ row }) => (
      <StatusBadge
        label={row.original.sender_type === "customer" ? "Kunde" : "Firma"}
        variant={row.original.sender_type === "customer" ? "warning" : "default"}
      />
    ),
  },
  {
    accessorKey: "read_at",
    header: "Lest",
    cell: ({ row }) =>
      row.original.sender_type === "customer" ? (
        <StatusBadge
          label={row.original.read_at ? "Lest" : "Ulest"}
          variant={row.original.read_at ? "muted" : "danger"}
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "created_at",
    header: "Tidspunkt",
    cell: ({ row }) => formatDateTime(row.original.created_at),
  },
]

export function CompanyMessagesClient({ messages }: { messages: CompanyMessageRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meldinger ({messages.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={messages}
          searchColumn="content"
          searchPlaceholder="Søk i meldinger..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.customer_name}</p>
                <StatusBadge
                  label={row.sender_type === "customer" ? "Kunde" : "Firma"}
                  variant={row.sender_type === "customer" ? "warning" : "default"}
                />
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{row.content}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
