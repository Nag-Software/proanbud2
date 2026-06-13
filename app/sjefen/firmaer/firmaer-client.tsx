"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { billingStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { billingStatusLabels, formatDate } from "@/lib/sjefen/format"
import type { SjefenCompanyRow } from "@/lib/sjefen/types"

const columns: ColumnDef<SjefenCompanyRow>[] = [
  {
    accessorKey: "name",
    header: "Firma",
    cell: ({ row }) => (
      <Link href={`/sjefen/firmaer/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "org_number",
    header: "Org.nr",
    cell: ({ row }) => row.original.org_number ?? "—",
  },
  {
    accessorKey: "email",
    header: "E-post",
    cell: ({ row }) => row.original.email ?? "—",
  },
  {
    accessorKey: "user_count",
    header: "Brukere",
  },
  {
    accessorKey: "offer_count",
    header: "Tilbud",
  },
  {
    accessorKey: "contract_count",
    header: "Kontrakter",
  },
  {
    accessorKey: "plan_key",
    header: "Plan",
    cell: ({ row }) => row.original.plan_key?.toUpperCase() ?? "—",
  },
  {
    accessorKey: "billing_status",
    header: "Abonnement",
    cell: ({ row }) => (
      <StatusBadge
        label={billingStatusLabels[row.original.billing_status ?? "incomplete"] ?? "Ukjent"}
        variant={billingStatusVariant(row.original.billing_status)}
      />
    ),
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function FirmaerClient({ companies }: { companies: SjefenCompanyRow[] }) {
  const router = useRouter()

  return (
    <SjefenPageShell segments={["Sjefen", "Firmaer"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Alle tenant
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Firmaer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companies.length} registrerte firmaer på plattformen.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Firmaoversikt</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={companies}
              searchColumn="name"
              searchPlaceholder="Søk firma..."
              onRowClick={(row) => router.push(`/sjefen/firmaer/${row.id}`)}
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
