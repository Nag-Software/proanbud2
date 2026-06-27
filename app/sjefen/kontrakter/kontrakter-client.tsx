"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { contractStatusLabels, formatDate, formatNok } from "@/lib/sjefen/format"
import type { SjefenContractRow } from "@/lib/sjefen/types"

const columns: ColumnDef<SjefenContractRow>[] = [
  {
    accessorKey: "title",
    header: "Kontrakt",
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
    accessorKey: "amount_nok",
    header: "Beløp",
    cell: ({ row }) => formatNok(row.original.amount_nok),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        label={contractStatusLabels[row.original.status] ?? row.original.status}
        variant={row.original.status === "completed" ? "success" : "default"}
      />
    ),
  },
  {
    accessorKey: "signed_at",
    header: "Signert",
    cell: ({ row }) => formatDate(row.original.signed_at),
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
]

export function KontrakterClient({ contracts }: { contracts: SjefenContractRow[] }) {
  const searchParams = useSearchParams()
  const companyFilter = searchParams.get("company")

  const filteredContracts = useMemo(() => {
    if (!companyFilter) return contracts
    return contracts.filter((contract) => contract.company_id === companyFilter)
  }, [contracts, companyFilter])

  const companyName = filteredContracts[0]?.company_name

  return (
    <SjefenPageShell segments={["Sjefen", "Kontrakter"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Alle kontrakter
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Kontrakter</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companyFilter ? (
              <>
                {filteredContracts.length} kontrakter for{" "}
                {companyName ?? "valgt firma"}.{" "}
                <Link href="/sjefen/kontrakter" className="font-medium underline underline-offset-2">
                  Vis alle
                </Link>
              </>
            ) : (
              `${filteredContracts.length} kontrakter på plattformen.`
            )}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontraktoversikt</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={filteredContracts}
              searchColumn="title"
              searchPlaceholder="Søk kontrakt..."
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
