"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { projectStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyProjectRow } from "@/lib/platform/company-content"
import {
  formatDate,
  formatNok,
  projectStatusLabels,
  projectTypeLabels,
} from "@/lib/sjefen/format"

const columns: ColumnDef<CompanyProjectRow>[] = [
  {
    accessorKey: "name",
    header: "Navn",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "customer_name",
    header: "Kunde",
    cell: ({ row }) => row.original.customer_name ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={projectStatusLabels[row.original.status] ?? row.original.status}
        variant={projectStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "project_type",
    header: "Type",
    cell: ({ row }) =>
      row.original.project_type
        ? (projectTypeLabels[row.original.project_type] ?? row.original.project_type)
        : "—",
  },
  {
    id: "period",
    header: "Periode",
    cell: ({ row }) =>
      row.original.start_date || row.original.end_date
        ? `${formatDate(row.original.start_date)} – ${formatDate(row.original.end_date)}`
        : "—",
  },
  {
    accessorKey: "budget_nok",
    header: "Budsjett",
    cell: ({ row }) =>
      row.original.budget_nok != null ? formatNok(row.original.budget_nok) : "—",
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function CompanyProjectsClient({ projects }: { projects: CompanyProjectRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prosjekter ({projects.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={projects}
          searchColumn="name"
          searchPlaceholder="Søk prosjekt..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.name}</p>
                <StatusBadge
                  label={projectStatusLabels[row.status] ?? row.status}
                  variant={projectStatusVariant(row.status)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {row.customer_name ?? "Ingen kunde"} · Opprettet {formatDate(row.created_at)}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
