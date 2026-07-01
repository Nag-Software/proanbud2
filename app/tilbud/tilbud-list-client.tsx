"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FileText, PlusCircle, Search } from "lucide-react"
import { cn } from "@/lib/utils"

export type OfferListRow = {
  id: string
  title: string
  shortId: string
  customer: string
  project: string
  amountNok: number
  status: "draft" | "sent" | "accepted" | "rejected"
  createdAt: string | null
}

type StatusFilter = "alle" | OfferListRow["status"]

// Samme etiketter og badge-stiler som tilbudsdetaljen og dashbordet
// (theme-badge-status-* i globals.css).
const STATUS_META: Record<
  OfferListRow["status"],
  { label: string; badgeClass: string }
> = {
  draft: { label: "Utkast", badgeClass: "theme-badge-status-draft" },
  sent: { label: "Sendt", badgeClass: "theme-badge-status-sent" },
  accepted: { label: "Godkjent", badgeClass: "theme-badge-status-accepted" },
  rejected: { label: "Avvist", badgeClass: "theme-badge-status-rejected" },
}

const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "alle", label: "Alle" },
  { value: "draft", label: "Utkast" },
  { value: "sent", label: "Sendt" },
  { value: "accepted", label: "Godkjent" },
  { value: "rejected", label: "Avvist" },
]

function isOfferStatus(value: string | null): value is OfferListRow["status"] {
  return value === "draft" || value === "sent" || value === "accepted" || value === "rejected"
}

const formatNok = (value: number) =>
  new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value)

function dateLabel(value: string | null) {
  if (!value) return "–"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "–"
  return date.toLocaleDateString("no-NO", { day: "numeric", month: "short", year: "numeric" })
}

function StatusBadge({ status }: { status: OfferListRow["status"] }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant="outline" className={cn("font-medium", meta.badgeClass)}>
      {meta.label}
    </Badge>
  )
}

export function TilbudListClient({ rows }: { rows: OfferListRow[] }) {
  const searchParams = useSearchParams()
  const rawStatus = searchParams.get("status")
  const activeStatus: StatusFilter = isOfferStatus(rawStatus) ? rawStatus : "alle"

  const [query, setQuery] = React.useState("")

  // Delbar/bokmerkbar URL (?status=sent) uten server-rundtur: Next synker
  // useSearchParams med native history-API-et (shallow routing).
  const selectStatus = React.useCallback((value: StatusFilter) => {
    const params = new URLSearchParams(window.location.search)
    if (value === "alle") params.delete("status")
    else params.set("status", value)
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `/tilbud?${qs}` : "/tilbud")
  }, [])

  const counts = React.useMemo(() => {
    const result: Record<StatusFilter, number> = {
      alle: rows.length,
      draft: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
    }
    for (const row of rows) result[row.status] += 1
    return result
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (activeStatus !== "alle" && row.status !== activeStatus) return false
      if (!q) return true
      return (
        row.title.toLowerCase().includes(q) ||
        row.customer.toLowerCase().includes(q) ||
        row.shortId.toLowerCase().includes(q)
      )
    })
  }, [rows, activeStatus, query])

  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Dine tilbud
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Tilbud
          </h1>
        </div>
        <div className="flex w-full items-center sm:w-auto">
          <Button asChild className="w-full sm:w-auto" size="default">
            <Link href="/nytt-tilbud">
              <PlusCircle className="mr-2 h-4 w-4" />
              Nytt tilbud
            </Link>
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <OnboardingEmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Søk på tilbudsnavn eller kunde …"
              aria-label="Søk i tilbud"
              className="pl-9"
            />
          </div>

          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="max-w-full overflow-x-auto">
              <div className="inline-flex rounded-md bg-secondary p-0.5 text-sm">
                {FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => selectStatus(value)}
                    aria-pressed={activeStatus === value}
                    className={cn(
                      "cursor-pointer rounded-[4px] px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                      activeStatus === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        "ml-1.5 text-xs tabular-nums",
                        activeStatus === value ? "text-muted-foreground" : "text-muted-foreground/70"
                      )}
                    >
                      {counts[value]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <span className="shrink-0 text-sm whitespace-nowrap text-muted-foreground">
              {filtered.length} tilbud
            </span>
          </div>

          {filtered.length === 0 ? (
            <NoMatchState query={query.trim()} />
          ) : (
            <>
              {/* Desktop: tabell */}
              <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card md:block">
                <Table>
                  <TableHeader className="border-b bg-muted/40">
                    <TableRow>
                      <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Tilbud
                      </TableHead>
                      <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Kunde
                      </TableHead>
                      <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Prosjekt
                      </TableHead>
                      <TableHead className="h-10 text-right text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Beløp
                      </TableHead>
                      <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="h-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Dato
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => (
                      <TableRow key={row.id} className="group hover:bg-muted/30">
                        <TableCell className="py-3 align-middle">
                          <Link href={`/tilbud/${row.id}`} className="block min-w-[200px]">
                            <span className="text-sm font-medium text-foreground group-hover:underline">
                              {row.title}
                            </span>
                            <span className="mt-0.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">
                              {row.shortId}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
                          <Link href={`/tilbud/${row.id}`} className="block text-sm text-foreground">
                            {row.customer || <span className="text-muted-foreground">–</span>}
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
                          <Link href={`/tilbud/${row.id}`} className="block text-sm text-muted-foreground">
                            {row.project || "–"}
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 text-right align-middle">
                          <Link
                            href={`/tilbud/${row.id}`}
                            className="block text-sm font-medium whitespace-nowrap text-foreground tabular-nums"
                          >
                            {formatNok(row.amountNok)}
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
                          <Link href={`/tilbud/${row.id}`} className="block">
                            <StatusBadge status={row.status} />
                          </Link>
                        </TableCell>
                        <TableCell className="py-3 align-middle">
                          <Link
                            href={`/tilbud/${row.id}`}
                            className="block text-sm whitespace-nowrap text-muted-foreground"
                          >
                            {dateLabel(row.createdAt)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobil: kortliste */}
              <div className="divide-y overflow-hidden rounded-xl border border-border/70 bg-card md:hidden">
                {filtered.map((row) => (
                  <Link
                    key={row.id}
                    href={`/tilbud/${row.id}`}
                    className="flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-muted/30 active:bg-muted"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {row.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[row.customer, row.project].filter(Boolean).join(" · ") || row.shortId}
                        </p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground tabular-nums">
                        {formatNok(row.amountNok)}
                      </span>
                      <span className="text-xs whitespace-nowrap text-muted-foreground">
                        {dateLabel(row.createdAt)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function OnboardingEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileText className="size-6" />
      </div>
      <p className="text-lg font-semibold text-foreground">Ingen tilbud ennå</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Tilbud er måten du vinner jobber på — lag det første på under fem minutter.
      </p>
      <Button asChild className="mt-2">
        <Link href="/nytt-tilbud">Lag ditt første tilbud</Link>
      </Button>
    </div>
  )
}

function NoMatchState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Search className="size-5" />
      </div>
      <p className="font-medium text-foreground">Ingen treff</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        {query
          ? `Fant ingen tilbud som matcher «${query}».`
          : "Ingen tilbud med denne statusen."}
      </p>
    </div>
  )
}
