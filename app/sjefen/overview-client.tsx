"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import {
  Building2Icon,
  FileTextIcon,
  InboxIcon,
  ReceiptIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react"
import { ColumnDef } from "@tanstack/react-table"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import {
  billingStatusVariant,
  offerStatusVariant,
  StatusBadge,
} from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  billingStatusLabels,
  formatDate,
  formatNok,
  formatRelative,
  offerStatusLabels,
} from "@/lib/sjefen/format"
import type {
  SjefenCompanyRow,
  SjefenMessageRow,
  SjefenOfferRow,
  SjefenOverviewStats,
} from "@/lib/sjefen/types"

function KpiCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string
  value: number | string
  hint?: string
  icon: ReactNode
}) {
  return (
    <Card className="theme-surface-hero border-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

const companyColumns: ColumnDef<SjefenCompanyRow>[] = [
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
    accessorKey: "user_count",
    header: "Brukere",
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

const offerColumns: ColumnDef<SjefenOfferRow>[] = [
  {
    accessorKey: "title",
    header: "Tilbud",
  },
  {
    accessorKey: "company_name",
    header: "Firma",
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
        label={offerStatusLabels[row.original.status] ?? row.original.status}
        variant={offerStatusVariant(row.original.status)}
      />
    ),
  },
  {
    accessorKey: "created_at",
    header: "Opprettet",
    cell: ({ row }) => formatRelative(row.original.created_at),
  },
]

const messageColumns: ColumnDef<SjefenMessageRow>[] = [
  {
    accessorKey: "company_name",
    header: "Firma",
  },
  {
    accessorKey: "customer_name",
    header: "Kunde",
  },
  {
    accessorKey: "content",
    header: "Melding",
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-md text-sm">{row.original.content}</span>
    ),
  },
  {
    accessorKey: "sender_type",
    header: "Fra",
    cell: ({ row }) => (row.original.sender_type === "customer" ? "Kunde" : "Firma"),
  },
  {
    accessorKey: "created_at",
    header: "Tid",
    cell: ({ row }) => formatRelative(row.original.created_at),
  },
]

export function OverviewClient({ stats }: { stats: SjefenOverviewStats }) {
  return (
    <SjefenPageShell segments={["Sjefen", "Oversikt"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Plattformkontroll
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Sjefen</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full oversikt over alle firmaer, brukere, tilbud, kontrakter, fakturaer og meldinger.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Firmaer" value={stats.companies} icon={<Building2Icon className="size-4" />} />
          <KpiCard
            title="Brukere"
            value={stats.users}
            hint={`${stats.activeUsers} aktive`}
            icon={<UsersIcon className="size-4" />}
          />
          <KpiCard title="Tilbud" value={stats.offers} icon={<FileTextIcon className="size-4" />} />
          <KpiCard title="Kontrakter" value={stats.contracts} icon={<ScrollTextIcon className="size-4" />} />
          <KpiCard title="Fakturaer" value={stats.invoices} icon={<ReceiptIcon className="size-4" />} />
          <KpiCard
            title="Meldinger"
            value={stats.messages}
            hint={`${stats.unreadMessages} uleste fra kunder`}
            icon={<InboxIcon className="size-4" />}
          />
          <KpiCard
            title="Aktive abonnement"
            value={stats.activeSubscriptions}
            icon={<Building2Icon className="size-4" />}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nyeste firmaer</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminDataTable
                columns={companyColumns}
                data={stats.recentCompanies}
                searchColumn="name"
                searchPlaceholder="Søk firma..."
                pageSize={5}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nyeste tilbud</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminDataTable
                columns={offerColumns}
                data={stats.recentOffers}
                searchColumn="title"
                searchPlaceholder="Søk tilbud..."
                pageSize={5}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Siste meldinger</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={messageColumns}
              data={stats.recentMessages}
              searchColumn="content"
              searchPlaceholder="Søk meldinger..."
              pageSize={8}
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
