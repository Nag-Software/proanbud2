"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import {
  ActivityIcon,
  CreditCardIcon,
  HourglassIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { KpiCard } from "@/components/sjefen/kpi-card"
import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import { billingStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { billingStatusLabels, formatDate, formatNok } from "@/lib/sjefen/format"
import type {
  PayingCompanyRow,
  SubscriptionDashboard,
} from "@/lib/sjefen/subscription-data"

const planLabels: Record<string, string> = { mini: "Mini", proff: "Proff" }
const intervalLabels: Record<string, string> = { month: "mnd", year: "år" }

function percent(value: number | null): string {
  if (value === null) return "—"
  return `${Math.round(value * 100)} %`
}

function planLabel(plan: string | null, interval: string | null): string {
  const p = plan ? (planLabels[plan] ?? plan) : "—"
  const i = interval ? intervalLabels[interval] ?? interval : null
  return i ? `${p} / ${i}` : p
}

const payingColumns: ColumnDef<PayingCompanyRow>[] = [
  {
    accessorKey: "company_name",
    header: "Firma",
    cell: ({ row }) =>
      row.original.company_id ? (
        <Link
          href={`/sjefen/firmaer/${row.original.company_id}`}
          className="font-medium hover:underline"
        >
          {row.original.company_name}
        </Link>
      ) : (
        <span className="text-muted-foreground">{row.original.company_name}</span>
      ),
  },
  {
    accessorKey: "plan_key",
    header: "Plan",
    cell: ({ row }) => planLabel(row.original.plan_key, row.original.billing_interval),
  },
  {
    accessorKey: "mrr_nok",
    header: "MRR",
    cell: ({ row }) => formatNok(row.original.mrr_nok),
  },
  {
    accessorKey: "paying_since",
    header: "Betalende siden",
    cell: ({ row }) => formatDate(row.original.paying_since),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <StatusBadge
          label={billingStatusLabels[row.original.status] ?? row.original.status}
          variant={billingStatusVariant(row.original.status)}
        />
        {row.original.comped && <StatusBadge label="Gratis" variant="muted" />}
        {row.original.cancel_at_period_end && (
          <span className="text-xs text-muted-foreground">sagt opp</span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "utm_source",
    header: "Kilde",
    cell: ({ row }) => row.original.utm_source ?? "—",
  },
]

export function AbonnementClient({ dashboard }: { dashboard: SubscriptionDashboard }) {
  const { kpis, stripeError, months, paying, sources, dbCounts } = dashboard
  const mrrDelta = kpis ? kpis.mrr - kpis.mrr30dAgo : 0
  const planHint = kpis
    ? Object.entries(kpis.payingByPlan)
        .map(([plan, count]) => `${count} ${planLabels[plan] ?? plan}`)
        .join(" · ")
    : undefined

  return (
    <SjefenPageShell segments={["Sjefen", "Abonnement"]}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Plattformkontroll
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Abonnement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            MRR, prøve→betalende og churn, regnet rett fra Stripe (oppdateres hvert 5. minutt).
          </p>
        </div>

        {stripeError && (
          <Card className="border-destructive/40">
            <CardContent className="py-4 text-sm">
              <p className="font-medium">Kunne ikke hente fra Stripe</p>
              <p className="mt-1 text-muted-foreground">{stripeError}</p>
              <p className="mt-2 text-muted-foreground">
                Fra databasen (status alene, uten beløp): {dbCounts.paying} aktive,{" "}
                {dbCounts.trialing} i prøve.
              </p>
            </CardContent>
          </Card>
        )}

        {kpis && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              title="MRR"
              value={formatNok(kpis.mrr)}
              hint={
                <span className={mrrDelta < 0 ? "text-destructive" : undefined}>
                  {mrrDelta >= 0 ? "+" : "−"}
                  {formatNok(Math.abs(mrrDelta))} siste 30 d · eks. mva
                </span>
              }
              icon={<CreditCardIcon className="size-4" />}
            />
            <KpiCard
              title="Betalende"
              value={kpis.paying}
              hint={`${planHint || "ingen ennå"}${kpis.comped ? ` · ${kpis.comped} gratis (100 % rabatt)` : ""}`}
              icon={<ActivityIcon className="size-4" />}
            />
            <KpiCard
              title="I prøve"
              value={kpis.trialing}
              hint="status trialing nå"
              icon={<HourglassIcon className="size-4" />}
            />
            <KpiCard
              title="Prøve → betalende"
              value={percent(kpis.trialCohort90d.rate)}
              hint={`${kpis.trialCohort90d.converted} av ${kpis.trialCohort90d.trials} prøver startet siste 90 d`}
              icon={<TrendingUpIcon className="size-4" />}
            />
            <KpiCard
              title="Churn 30 d"
              value={percent(kpis.churn30d.rate)}
              hint={`${kpis.churn30d.churned} av ${kpis.churn30d.payingAtStart} betalende for 30 d siden`}
              icon={<TrendingDownIcon className="size-4" />}
            />
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Siste 6 måneder</CardTitle>
            </CardHeader>
            <CardContent>
              {months.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen data.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Måned</TableHead>
                      <TableHead className="text-right">Nye prøver</TableHead>
                      <TableHead className="text-right">Konvertert</TableHead>
                      <TableHead className="text-right">Konv.</TableHead>
                      <TableHead className="text-right">Nye betalende</TableHead>
                      <TableHead className="text-right">Churnet</TableHead>
                      <TableHead className="text-right">MRR ved slutt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {months.map((row) => (
                      <TableRow key={row.month}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="text-right">{row.newTrials}</TableCell>
                        <TableCell className="text-right">{row.converted}</TableCell>
                        <TableCell className="text-right">{percent(row.conversionRate)}</TableCell>
                        <TableCell className="text-right">{row.newPaying}</TableCell>
                        <TableCell className="text-right">{row.churned}</TableCell>
                        <TableCell className="text-right">{formatNok(row.mrrEnd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                «Konvertert» følger måneden prøven startet og teller også når bedriften tegnet et
                nytt abonnement etter prøven. Prøver som bare utløp teller ikke som churn.
                Gratis-abonnement (100 % rabatt) teller ikke som betalende.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nye firmaer siste 30 d per kilde</CardTitle>
            </CardHeader>
            <CardContent>
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen nye firmaer siste 30 dager.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kilde</TableHead>
                      <TableHead className="text-right">Firmaer</TableHead>
                      <TableHead className="text-right">I prøve</TableHead>
                      <TableHead className="text-right">Betalende</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((row) => (
                      <TableRow key={row.source}>
                        <TableCell className="font-medium">{row.source}</TableCell>
                        <TableCell className="text-right">{row.companies}</TableCell>
                        <TableCell className="text-right">{row.trialing}</TableCell>
                        <TableCell className="text-right">{row.paying}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Levende abonnement</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={payingColumns}
              data={paying}
              searchColumn="company_name"
              searchPlaceholder="Søk firma..."
              pageSize={10}
            />
          </CardContent>
        </Card>
      </div>
    </SjefenPageShell>
  )
}
