"use client"

import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getRoleDisplayName } from "@/lib/roles"
import { formatDate } from "@/lib/sjefen/format"
import type { SjefenUserRow } from "@/lib/sjefen/types"

const columns: ColumnDef<SjefenUserRow>[] = [
  {
    accessorKey: "full_name",
    header: "Navn",
  },
  {
    accessorKey: "email",
    header: "E-post",
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
    accessorKey: "role",
    header: "Rolle",
    cell: ({ row }) => getRoleDisplayName(row.original.role),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={row.original.is_active ? "Aktiv" : "Inaktiv"}
        variant={row.original.is_active ? "success" : "muted"}
      />
    ),
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function BrukereClient({ users }: { users: SjefenUserRow[] }) {
  return (
    <SjefenPageShell segments={["Sjefen", "Brukere"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Alle brukere
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Brukere</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} brukere på tvers av alle firmaer.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brukerliste</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={users}
              searchColumn="full_name"
              searchPlaceholder="Søk navn..."
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
