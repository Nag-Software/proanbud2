"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import {
  StatusBadge,
  taskPriorityVariant,
  taskStatusVariant,
} from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyTaskRow } from "@/lib/platform/company-content"
import { formatDate, taskPriorityLabels, taskStatusLabels } from "@/lib/sjefen/format"

const columns: ColumnDef<CompanyTaskRow>[] = [
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
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={taskStatusLabels[row.original.status] ?? row.original.status}
        variant={taskStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "priority",
    header: "Prioritet",
    cell: ({ row }) => (
      <StatusBadge
        label={taskPriorityLabels[row.original.priority] ?? row.original.priority}
        variant={taskPriorityVariant(row.original.priority)}
      />
    ),
  },
  {
    accessorKey: "due_date",
    header: "Frist",
    cell: ({ row }) => formatDate(row.original.due_date),
  },
  {
    accessorKey: "assignee_name",
    header: "Ansvarlig",
    cell: ({ row }) => row.original.assignee_name ?? "—",
  },
]

export function CompanyTasksClient({ tasks }: { tasks: CompanyTaskRow[] }) {
  const openCount = tasks.filter((task) => task.status !== "done").length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Oppgaver ({tasks.length})
          {openCount > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {openCount} åpne
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={tasks}
          searchColumn="title"
          searchPlaceholder="Søk oppgave..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.title}</p>
                <StatusBadge
                  label={taskStatusLabels[row.status] ?? row.status}
                  variant={taskStatusVariant(row.status)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {row.project_name ?? "Uten prosjekt"}
                {row.due_date ? ` · Frist ${formatDate(row.due_date)}` : ""}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
