"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyCalendarEventRow } from "@/lib/platform/company-content"
import { formatDateTime } from "@/lib/sjefen/format"

function isUpcoming(row: CompanyCalendarEventRow) {
  return new Date(row.ends_at).getTime() >= Date.now()
}

const columns: ColumnDef<CompanyCalendarEventRow>[] = [
  {
    accessorKey: "title",
    header: "Tittel",
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: "project_name",
    header: "Prosjekt",
    cell: ({ row }) => row.original.project_name ?? "—",
  },
  {
    accessorKey: "starts_at",
    header: "Start",
    cell: ({ row }) => formatDateTime(row.original.starts_at),
  },
  {
    accessorKey: "ends_at",
    header: "Slutt",
    cell: ({ row }) => formatDateTime(row.original.ends_at),
  },
  {
    id: "timing",
    header: "",
    cell: ({ row }) =>
      isUpcoming(row.original) ? <StatusBadge label="Kommende" variant="success" /> : null,
  },
]

export function CompanyCalendarClient({ events }: { events: CompanyCalendarEventRow[] }) {
  const upcomingCount = events.filter(isUpcoming).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Kalenderhendelser ({events.length})
          {upcomingCount > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {upcomingCount} kommende
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={events}
          searchColumn="title"
          searchPlaceholder="Søk hendelse..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.title}</p>
                {isUpcoming(row) && <StatusBadge label="Kommende" variant="success" />}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(row.starts_at)}
                {row.project_name ? ` · ${row.project_name}` : ""}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
