"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ExternalLinkIcon } from "lucide-react"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { offerStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyOfferRow } from "@/lib/platform/company-content"
import { formatDate, formatNok, offerStatusLabels } from "@/lib/sjefen/format"

const columns: ColumnDef<CompanyOfferRow>[] = [
  {
    accessorKey: "title",
    header: "Tittel",
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: "customer_name",
    header: "Kunde",
    cell: ({ row }) => row.original.customer_name ?? "—",
  },
  {
    accessorKey: "project_name",
    header: "Prosjekt",
    cell: ({ row }) => row.original.project_name ?? "—",
  },
  {
    accessorKey: "amount_nok",
    header: "Beløp",
    cell: ({ row }) => formatNok(row.original.amount_nok),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={offerStatusLabels[row.original.status] ?? row.original.status}
        variant={offerStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "sent_at",
    header: "Sendt",
    cell: ({ row }) =>
      row.original.sent_at
        ? `${formatDate(row.original.sent_at)}${row.original.recipient_email ? ` til ${row.original.recipient_email}` : ""}`
        : "—",
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    id: "actions",
    header: "Kundevisning",
    cell: ({ row }) =>
      row.original.public_slug ? (
        <a
          href={`/tilbudsvisning/${row.original.public_slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
          onClick={(event) => event.stopPropagation()}
        >
          Åpne
          <ExternalLinkIcon className="size-3.5" />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

export function CompanyOffersClient({ offers }: { offers: CompanyOfferRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tilbud ({offers.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={offers}
          searchColumn="title"
          searchPlaceholder="Søk tilbud..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.title}</p>
                <StatusBadge
                  label={offerStatusLabels[row.status] ?? row.status}
                  variant={offerStatusVariant(row.status)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {row.customer_name ?? "Ingen kunde"} · {formatNok(row.amount_nok)}
              </p>
              {row.public_slug && (
                <a
                  href={`/tilbudsvisning/${row.public_slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
                  onClick={(event) => event.stopPropagation()}
                >
                  Åpne kundevisning
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              )}
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
