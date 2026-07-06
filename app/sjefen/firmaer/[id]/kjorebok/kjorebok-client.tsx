"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyTripRow } from "@/lib/platform/company-content"
import { formatDate, formatNok, tripClassificationLabels } from "@/lib/sjefen/format"

const columns: ColumnDef<CompanyTripRow>[] = [
  {
    accessorKey: "trip_date",
    header: "Dato",
    cell: ({ row }) => formatDate(row.original.trip_date),
  },
  {
    accessorKey: "driver_name",
    header: "Sjåfør",
    cell: ({ row }) => <span className="font-medium">{row.original.driver_name}</span>,
  },
  {
    id: "route",
    header: "Rute",
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-[320px] whitespace-normal text-sm">
        {[row.original.from_address, row.original.to_address].filter(Boolean).join(" → ") || "—"}
      </span>
    ),
  },
  {
    accessorKey: "distance_km",
    header: "Km",
    cell: ({ row }) =>
      `${row.original.distance_km.toLocaleString("no-NO", { maximumFractionDigits: 1 })} km`,
  },
  {
    accessorKey: "amount_nok",
    header: "Beløp",
    cell: ({ row }) => formatNok(row.original.amount_nok),
  },
  {
    accessorKey: "classification",
    header: "Klassifisering",
    cell: ({ row }) => (
      <StatusBadge
        label={
          tripClassificationLabels[row.original.classification] ?? row.original.classification
        }
        variant={row.original.classification === "business" ? "default" : "muted"}
      />
    ),
  },
  {
    accessorKey: "project_name",
    header: "Prosjekt",
    cell: ({ row }) => row.original.project_name ?? "—",
  },
]

export function CompanyTripsClient({ trips }: { trips: CompanyTripRow[] }) {
  const totalKm = trips.reduce((sum, trip) => sum + trip.distance_km, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Kjørebok-turer ({trips.length})
          {trips.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {totalKm.toLocaleString("no-NO", { maximumFractionDigits: 0 })} km i visningen
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={trips}
          searchColumn="driver_name"
          searchPlaceholder="Søk sjåfør..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.driver_name}</p>
                <span className="text-sm">
                  {row.distance_km.toLocaleString("no-NO", { maximumFractionDigits: 1 })} km
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDate(row.trip_date)} ·{" "}
                {[row.from_address, row.to_address].filter(Boolean).join(" → ") || "Uten rute"}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
