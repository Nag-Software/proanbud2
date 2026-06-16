"use client"

import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime, formatRelative } from "@/lib/selger/format"
import type { SelgerActivityRow, SelgerEmailLogRow } from "@/lib/selger/types"
import { sellerActionLabels } from "@/lib/selger/types"

type UnifiedRow = {
  id: string
  type: string
  company_name: string | null
  detail: string
  seller_email: string | null
  created_at: string
}

function buildUnifiedLog(
  activity: SelgerActivityRow[],
  emailLog: SelgerEmailLogRow[]
): UnifiedRow[] {
  const rows: UnifiedRow[] = [
    ...activity.map((row) => ({
      id: `a-${row.id}`,
      type: sellerActionLabels[row.action] ?? row.action,
      company_name: row.company_name,
      detail:
        typeof row.metadata.recipientEmail === "string"
          ? row.metadata.recipientEmail
          : row.target_type ?? "—",
      seller_email: row.seller_email,
      created_at: row.created_at,
    })),
    ...emailLog.map((row) => ({
      id: `e-${row.id}`,
      type: `E-post (${row.template_id})`,
      company_name: row.company_name,
      detail: row.recipient_email,
      seller_email: row.sent_by_email,
      created_at: row.created_at,
    })),
  ]

  return rows.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

const columns: ColumnDef<UnifiedRow>[] = [
  {
    accessorKey: "created_at",
    header: "Tid",
    cell: ({ row }) => (
      <span title={formatDateTime(row.original.created_at)}>
        {formatRelative(row.original.created_at)}
      </span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
  },
  {
    accessorKey: "company_name",
    header: "Firma",
    cell: ({ row }) =>
      row.original.company_name ? (
        <span>{row.original.company_name}</span>
      ) : (
        "—"
      ),
  },
  {
    accessorKey: "detail",
    header: "Detalj",
  },
  {
    accessorKey: "seller_email",
    header: "Selger",
    cell: ({ row }) => row.original.seller_email ?? "—",
  },
]

export function AktivitetClient({
  activity,
  emailLog,
}: {
  activity: SelgerActivityRow[]
  emailLog: SelgerEmailLogRow[]
}) {
  const rows = buildUnifiedLog(activity, emailLog)

  return (
    <SelgerPageShell segments={["Selger", "Aktivitet"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aktivitet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Total logg over samtaler, e-poster og handlinger.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totallogg</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={rows}
              searchColumn="company_name"
              searchPlaceholder="Søk firma..."
            />
          </CardContent>
        </Card>
      </div>
    </SelgerPageShell>
  )
}
