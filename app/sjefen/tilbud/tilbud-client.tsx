"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { offerStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNok, formatRelative, offerStatusLabels } from "@/lib/sjefen/format"
import type { SjefenOfferRow } from "@/lib/sjefen/types"

const columns: ColumnDef<SjefenOfferRow>[] = [
  {
    accessorKey: "title",
    header: "Tittel",
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
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatRelative(row.original.created_at),
  },
]

export function TilbudClient({ offers }: { offers: SjefenOfferRow[] }) {
  const searchParams = useSearchParams()
  const companyFilter = searchParams.get("company")

  const filteredOffers = useMemo(() => {
    if (!companyFilter) return offers
    return offers.filter((offer) => offer.company_id === companyFilter)
  }, [offers, companyFilter])

  const companyName = filteredOffers[0]?.company_name

  return (
    <SjefenPageShell segments={["Sjefen", "Tilbud"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Alle tilbud
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Tilbud</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companyFilter ? (
              <>
                {filteredOffers.length} tilbud for{" "}
                {companyName ?? "valgt firma"}.{" "}
                <Link href="/sjefen/tilbud" className="font-medium underline underline-offset-2">
                  Vis alle
                </Link>
              </>
            ) : (
              `${filteredOffers.length} tilbud på plattformen.`
            )}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tilbudsoversikt</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={filteredOffers}
              searchColumn="title"
              searchPlaceholder="Søk tilbud..."
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
