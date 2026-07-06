"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import {
  checklistStatusVariant,
  deviationStatusVariant,
  StatusBadge,
} from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type {
  CompanyChecklistRow,
  CompanyDeviationRow,
} from "@/lib/platform/company-content"
import {
  checklistStatusLabels,
  deviationStatusLabels,
  deviationTypeLabels,
  formatDate,
} from "@/lib/sjefen/format"

const deviationColumns: ColumnDef<CompanyDeviationRow>[] = [
  {
    accessorKey: "reference_number",
    header: "Ref",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.reference_number}</span>
    ),
  },
  {
    accessorKey: "title",
    header: "Tittel",
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => deviationTypeLabels[row.original.type] ?? row.original.type,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={deviationStatusLabels[row.original.status] ?? row.original.status}
        variant={deviationStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "project_name",
    header: "Prosjekt",
    cell: ({ row }) => row.original.project_name ?? "—",
  },
  {
    accessorKey: "created_at",
    header: "Meldt",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    accessorKey: "closed_at",
    header: "Lukket",
    cell: ({ row }) => formatDate(row.original.closed_at),
  },
]

const checklistColumns: ColumnDef<CompanyChecklistRow>[] = [
  {
    accessorKey: "name",
    header: "Navn",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "project_name",
    header: "Prosjekt",
    cell: ({ row }) => row.original.project_name ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={checklistStatusLabels[row.original.status] ?? row.original.status}
        variant={checklistStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    accessorKey: "completed_at",
    header: "Fullført",
    cell: ({ row }) => formatDate(row.original.completed_at),
  },
]

export function CompanyHmsClient({
  deviations,
  checklists,
}: {
  deviations: CompanyDeviationRow[]
  checklists: CompanyChecklistRow[]
}) {
  const openDeviations = deviations.filter((deviation) => deviation.status === "open").length

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Avvik ({deviations.length})
            {openDeviations > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {openDeviations} åpne
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AdminDataTable
            columns={deviationColumns}
            data={deviations}
            searchColumn="title"
            searchPlaceholder="Søk avvik..."
            renderMobileRow={(row) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{row.title}</p>
                  <StatusBadge
                    label={deviationStatusLabels[row.status] ?? row.status}
                    variant={deviationStatusVariant(row.status)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {row.reference_number} · {deviationTypeLabels[row.type] ?? row.type} ·{" "}
                  {formatDate(row.created_at)}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">KS-sjekklister ({checklists.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminDataTable
            columns={checklistColumns}
            data={checklists}
            searchColumn="name"
            searchPlaceholder="Søk sjekkliste..."
            renderMobileRow={(row) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{row.name}</p>
                  <StatusBadge
                    label={checklistStatusLabels[row.status] ?? row.status}
                    variant={checklistStatusVariant(row.status)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {row.project_name ?? "Uten prosjekt"} · {formatDate(row.created_at)}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
