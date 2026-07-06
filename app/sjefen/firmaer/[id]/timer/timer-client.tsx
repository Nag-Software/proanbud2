"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { StatusBadge, timeEntryStatusVariant } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyTimeEntryRow } from "@/lib/platform/company-content"
import { formatDate, formatHours, timeEntryStatusLabels } from "@/lib/sjefen/format"

function isOpenEntry(row: CompanyTimeEntryRow) {
  return row.started_at != null && row.ended_at == null
}

const columns: ColumnDef<CompanyTimeEntryRow>[] = [
  {
    accessorKey: "entry_date",
    header: "Dato",
    cell: ({ row }) => formatDate(row.original.entry_date),
  },
  {
    accessorKey: "user_name",
    header: "Ansatt",
    cell: ({ row }) => <span className="font-medium">{row.original.user_name}</span>,
  },
  {
    accessorKey: "project_name",
    header: "Prosjekt",
    cell: ({ row }) => row.original.project_name ?? "—",
  },
  {
    accessorKey: "hours",
    header: "Timer",
    cell: ({ row }) =>
      isOpenEntry(row.original) ? (
        <StatusBadge label="Pågår" variant="success" />
      ) : (
        formatHours(row.original.hours)
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={timeEntryStatusLabels[row.original.status] ?? row.original.status}
        variant={timeEntryStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "description",
    header: "Beskrivelse",
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-[320px] whitespace-normal text-sm">
        {row.original.description ?? "—"}
      </span>
    ),
  },
]

export function CompanyTimeEntriesClient({ entries }: { entries: CompanyTimeEntryRow[] }) {
  const openCount = entries.filter(isOpenEntry).length
  const totalHours = entries.reduce((sum, entry) => sum + (entry.hours ?? 0), 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Timeføring ({entries.length})
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {formatHours(totalHours)} i visningen{openCount > 0 ? ` · ${openCount} pågår nå` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={entries}
          searchColumn="user_name"
          searchPlaceholder="Søk ansatt..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.user_name}</p>
                {isOpenEntry(row) ? (
                  <StatusBadge label="Pågår" variant="success" />
                ) : (
                  <span className="text-sm">{formatHours(row.hours)}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDate(row.entry_date)} · {row.project_name ?? "Uten prosjekt"}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
