import Link from "next/link"
import { notFound } from "next/navigation"

import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { billingStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getRoleDisplayName } from "@/lib/roles"
import { fetchSjefenCompany } from "@/lib/sjefen/queries"
import { billingStatusLabels, formatDate, formatDateTime } from "@/lib/sjefen/format"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { company, users, billing, stats } = await fetchSjefenCompany(id)

  if (!company) {
    notFound()
  }

  return (
    <SjefenPageShell segments={["Sjefen", "Firmaer", company.name]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Firma
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Org.nr {company.org_number ?? "—"} · Opprettet {formatDate(company.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              label={billingStatusLabels[billing?.status ?? "incomplete"] ?? "Ukjent"}
              variant={billingStatusVariant(billing?.status ?? null)}
            />
            {billing?.plan_key && (
              <Badge variant="outline" className="rounded-none uppercase tracking-[0.22em]">
                {billing.plan_key}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Brukere", value: users.length },
            { label: "Kunder", value: stats.customers },
            { label: "Prosjekter", value: stats.projects },
            { label: "Tilbud", value: stats.offers },
            { label: "Meldinger", value: stats.messages },
          ].map((item) => (
            <Card key={item.label} className="theme-surface-hero border-0 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{item.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Firmadetaljer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">E-post</span>
                <span>{company.email ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Telefon</span>
                <span>{company.phone ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Kontrakter</span>
                <span>{stats.contracts}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Stripe-kunde</span>
                <span className="truncate">{billing?.stripe_customer_id ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Periode slutt</span>
                <span>{formatDateTime(billing?.current_period_end)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brukere i firmaet</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Navn</TableHead>
                    <TableHead>E-post</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{getRoleDisplayName(user.role)}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={user.is_active ? "Aktiv" : "Inaktiv"}
                          variant={user.is_active ? "success" : "muted"}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              <div className="divide-y md:hidden">
                {users.map((user) => (
                  <div key={user.id} className="py-3 first:pt-0">
                    <p className="font-medium">{user.full_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span>{getRoleDisplayName(user.role)}</span>
                      <StatusBadge
                        label={user.is_active ? "Aktiv" : "Inaktiv"}
                        variant={user.is_active ? "success" : "muted"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snarveier</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link
              href={`/sjefen/tilbud?company=${company.id}`}
              className="text-sm underline underline-offset-4"
            >
              Se tilbud
            </Link>
            <Link
              href={`/sjefen/kontrakter?company=${company.id}`}
              className="text-sm underline underline-offset-4"
            >
              Se kontrakter
            </Link>
            <Link
              href={`/sjefen/meldinger?company=${company.id}`}
              className="text-sm underline underline-offset-4"
            >
              Se meldinger
            </Link>
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
