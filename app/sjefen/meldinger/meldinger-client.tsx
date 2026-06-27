"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime } from "@/lib/sjefen/format"
import type { SjefenMessageRow } from "@/lib/sjefen/types"

const columns: ColumnDef<SjefenMessageRow>[] = [
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
    accessorKey: "customer_name",
    header: "Kunde",
  },
  {
    accessorKey: "content",
    header: "Melding",
    cell: ({ row }) => (
      <span className="line-clamp-2 max-w-lg text-sm">{row.original.content}</span>
    ),
  },
  {
    accessorKey: "sender_type",
    header: "Fra",
    cell: ({ row }) => (row.original.sender_type === "customer" ? "Kunde" : "Firma"),
  },
  {
    accessorKey: "read_at",
    header: "Lest",
    cell: ({ row }) =>
      row.original.sender_type === "customer" ? (
        <StatusBadge
          label={row.original.read_at ? "Lest" : "Ulest"}
          variant={row.original.read_at ? "success" : "warning"}
        />
      ) : (
        "—"
      ),
  },
  {
    accessorKey: "created_at",
    header: "Tidspunkt",
    cell: ({ row }) => formatDateTime(row.original.created_at),
  },
]

export function MeldingerClient({ messages }: { messages: SjefenMessageRow[] }) {
  const searchParams = useSearchParams()
  const companyFilter = searchParams.get("company")

  const filteredMessages = useMemo(() => {
    if (!companyFilter) return messages
    return messages.filter((message) => message.company_id === companyFilter)
  }, [messages, companyFilter])

  const unreadCount = filteredMessages.filter(
    (message) => message.sender_type === "customer" && !message.read_at
  ).length

  const companyName = filteredMessages[0]?.company_name

  return (
    <SjefenPageShell segments={["Sjefen", "Meldinger"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Alle meldinger
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Meldinger</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companyFilter ? (
              <>
                {filteredMessages.length} meldinger for {companyName ?? "valgt firma"} ·{" "}
                {unreadCount} uleste fra kunder.{" "}
                <Link href="/sjefen/meldinger" className="font-medium underline underline-offset-2">
                  Vis alle
                </Link>
              </>
            ) : (
              `${filteredMessages.length} meldinger · ${unreadCount} uleste fra kunder.`
            )}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meldingslogg</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={columns}
              data={filteredMessages}
              searchColumn="content"
              searchPlaceholder="Søk meldinger..."
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
