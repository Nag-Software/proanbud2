import Link from "next/link"
import { notFound } from "next/navigation"

import { StatusBadge } from "@/components/sjefen/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fetchCompanyContentStats } from "@/lib/platform/company-content"
import { getRoleDisplayName } from "@/lib/roles"
import { formatDateTime, formatRelative } from "@/lib/sjefen/format"
import { fetchSjefenCompany } from "@/lib/sjefen/queries"
import type { SjefenCompanyUserRow } from "@/lib/sjefen/types"

function latest(values: Array<string | null | undefined>): string | null {
  let result: string | null = null
  for (const value of values) {
    if (value && (!result || value > result)) {
      result = value
    }
  }
  return result
}

function lastSignInLabel(user: SjefenCompanyUserRow): string {
  if (user.last_sign_in_at === undefined) return "—"
  if (user.last_sign_in_at === null) return "Aldri"
  return formatRelative(user.last_sign_in_at)
}

export const dynamic = "force-dynamic"

export default async function SjefenFirmaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [{ company, users, billing }, content] = await Promise.all([
    fetchSjefenCompany(id),
    fetchCompanyContentStats(id),
  ])

  if (!company) {
    notFound()
  }

  const base = `/sjefen/firmaer/${company.id}`

  const admins = users.filter((user) => user.role === "admin")
  const adminLastSignIn = latest(admins.map((user) => user.last_sign_in_at))
  const adminNeverSignedIn =
    !adminLastSignIn && admins.some((user) => user.last_sign_in_at === null)
  const lastActiveAt = latest(users.map((user) => user.last_seen_at))

  const contentCards: Array<{
    label: string
    value: number
    href: string
    hint?: string
  }> = [
    { label: "Prosjekter", value: content.projects, href: `${base}/prosjekter` },
    { label: "Tilbud", value: content.offers, href: `${base}/tilbud` },
    { label: "Kontrakter", value: content.contracts, href: `${base}/kontrakter` },
    { label: "Kunder", value: content.customers, href: `${base}/kunder` },
    {
      label: "Meldinger",
      value: content.messages,
      href: `${base}/meldinger`,
      hint: content.unreadMessages > 0 ? `${content.unreadMessages} uleste fra kunder` : undefined,
    },
    { label: "Dokumenter", value: content.documents, href: `${base}/dokumenter` },
    {
      label: "Timeføringer",
      value: content.timeEntries,
      href: `${base}/timer`,
      hint: content.openTimeEntries > 0 ? `${content.openTimeEntries} pågår nå` : undefined,
    },
    { label: "Oppgaver", value: content.tasks, href: `${base}/oppgaver` },
    { label: "Kalenderhendelser", value: content.calendarEvents, href: `${base}/kalender` },
    {
      label: "Avvik",
      value: content.deviations,
      href: `${base}/hms`,
      hint: content.openDeviations > 0 ? `${content.openDeviations} åpne` : undefined,
    },
    { label: "KS-sjekklister", value: content.checklists, href: `${base}/hms` },
    { label: "Kjørebok-turer", value: content.trips, href: `${base}/kjorebok` },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {contentCards.map((item) => (
          <Link key={item.label} href={item.href} className="group">
            <Card className="theme-surface-hero h-full border-0 shadow-none transition-colors group-hover:bg-muted/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{item.value}</div>
                {item.hint && (
                  <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {item.hint}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
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
              <span className="text-muted-foreground">Brukere</span>
              <span>{users.length}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Admin sist innlogget</span>
              <span>
                {adminLastSignIn
                  ? formatRelative(adminLastSignIn)
                  : adminNeverSignedIn
                    ? "Aldri"
                    : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Sist aktiv i firmaet</span>
              <span>{lastActiveAt ? formatRelative(lastActiveAt) : "Aldri"}</span>
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
                    <TableHead>Sist innlogget</TableHead>
                    <TableHead>Sist aktiv</TableHead>
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
                      <TableCell>{lastSignInLabel(user)}</TableCell>
                      <TableCell>
                        {user.last_seen_at ? formatRelative(user.last_seen_at) : "—"}
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sist innlogget {lastSignInLabel(user)} · Sist aktiv{" "}
                    {user.last_seen_at ? formatRelative(user.last_seen_at) : "—"}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
