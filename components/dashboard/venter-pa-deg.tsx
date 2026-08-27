"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"
import { useUserRole } from "@/hooks/use-user-role"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * «Venter på deg» — det første du ser på dashbordet.
 *
 * Ett prinsipp: hver rad er én setning om noe som faktisk står stille, og én
 * knapp som gjør noe med det. Ingen tall uten en handling ved siden av.
 *
 * Radene bygges bare på felter som finnes i basen (offers.customer_viewed_at,
 * time_entries.status, tasks.due_date, deviations.status) — ikke på antakelser
 * om hva brukeren burde ha gjort. Feiler én spørring, faller den raden bort i
 * stillhet; dashbordet skal aldri kneble på grunn av denne lista.
 */
type Tone = "warning" | "info" | "danger" | "success"

type WaitingItem = {
  key: string
  tone: Tone
  icon: LucideIcon
  title: string
  meta: string
  href: string
  action: string
}

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  warning: { bg: "var(--overlay-warning)", fg: "var(--tone-warning)" },
  info: { bg: "var(--overlay-info)", fg: "var(--tone-info)" },
  danger: { bg: "var(--overlay-danger)", fg: "var(--tone-danger)" },
  success: { bg: "var(--overlay-success)", fg: "var(--tone-success)" },
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ROWS = 4

const nokFormatter = new Intl.NumberFormat("no-NO", {
  style: "currency",
  currency: "NOK",
  maximumFractionDigits: 0,
})

function daysSince(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
}

function dayText(days: number): string {
  if (days <= 0) return "i dag"
  if (days === 1) return "i går"
  return `for ${days} dager siden`
}

type OfferRow = {
  id: string
  title: string | null
  amount_nok: number | null
  sent_at: string | null
  customers: { name: string | null } | { name: string | null }[] | null
}

type TaskRow = {
  id: string
  title: string | null
  due_date: string | null
  project_id: string
}

function customerName(row: OfferRow): string | null {
  const c = row.customers
  if (!c) return null
  return Array.isArray(c) ? (c[0]?.name ?? null) : c.name
}

/** Kun for skjermbilder i dev — se ?mock=1 under. */
const MOCK_ITEMS: WaitingItem[] = [
  {
    key: "mock-offer",
    tone: "warning",
    icon: AlertTriangleIcon,
    title: "Bad og våtrom, Storgata 14 er ikke åpnet av kunden",
    meta: "Sendt for 6 dager siden · 148 000 kr · Berg Eiendom AS",
    href: "#",
    action: "Følg opp",
  },
  {
    key: "mock-hours",
    tone: "info",
    icon: ClockIcon,
    title: "12 timer venter på godkjenning",
    meta: "3 føringer",
    href: "#",
    action: "Se og godkjenn",
  },
  {
    key: "mock-tasks",
    tone: "danger",
    icon: FileTextIcon,
    title: "2 oppgaver er over fristen",
    meta: "Eldste forfalt for 4 dager siden",
    href: "#",
    action: "Åpne oppgavene",
  },
]

export function VenterPaDeg({ companyId }: { companyId: string | null }) {
  const { isWorker, loadingRole } = useUserRole()
  const [items, setItems] = React.useState<WaitingItem[] | null>(null)

  React.useEffect(() => {
    // ?mock=1 er husets skjermbilde-flagg (samme som dashbordet ellers). Her er
    // det låst til dev: radene lenker til id-er som ikke finnes, og skal aldri
    // kunne vises for en ekte bruker.
    if (
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("mock") === "1"
    ) {
      setItems(MOCK_ITEMS)
      return
    }

    if (!companyId) return
    let cancelled = false

    async function load(company: string) {
      const supabase = createClient()
      const nowIso = new Date().toISOString()
      const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS).toISOString()

      const [offers, hours, tasks, deviations] = await Promise.all([
        supabase
          .from("offers")
          .select("id, title, amount_nok, sent_at, customers(name)")
          .eq("company_id", company)
          .eq("status", "sent")
          .is("customer_viewed_at", null)
          .not("sent_at", "is", null)
          .lte("sent_at", threeDaysAgo)
          .order("sent_at", { ascending: true })
          .limit(3),
        supabase
          .from("time_entries")
          .select("hours")
          .eq("company_id", company)
          .eq("status", "pending"),
        supabase
          .from("tasks")
          .select("id, title, due_date, project_id")
          .eq("company_id", company)
          .neq("status", "done")
          .not("due_date", "is", null)
          .lt("due_date", nowIso)
          .order("due_date", { ascending: true })
          .limit(3),
        supabase
          .from("deviations")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company)
          .eq("status", "open"),
      ])

      if (cancelled) return

      const next: WaitingItem[] = []

      // 1. Tilbud kunden ikke har åpnet — det dyreste som står stille.
      for (const row of (offers.data ?? []) as OfferRow[]) {
        const who = customerName(row)
        const amount = row.amount_nok ? nokFormatter.format(row.amount_nok) : null
        next.push({
          key: `offer-${row.id}`,
          tone: "warning",
          icon: AlertTriangleIcon,
          title: `${row.title || "Tilbudet"} er ikke åpnet av kunden`,
          meta: [`Sendt ${dayText(daysSince(row.sent_at))}`, amount, who]
            .filter(Boolean)
            .join(" · "),
          href: `/tilbud/${row.id}`,
          action: "Følg opp",
        })
      }

      // 2. Timer til godkjenning — bare for dem som faktisk kan godkjenne.
      const pending = (hours.data ?? []) as { hours: number | null }[]
      if (!isWorker && pending.length > 0) {
        const total = pending.reduce((sum, row) => sum + Number(row.hours ?? 0), 0)
        next.push({
          key: "hours",
          tone: "info",
          icon: ClockIcon,
          title: `${total.toLocaleString("no-NO")} timer venter på godkjenning`,
          meta: `${pending.length} ${pending.length === 1 ? "føring" : "føringer"}`,
          href: "/min-bedrift/timeforing",
          action: "Se og godkjenn",
        })
      }

      // 3. Oppgaver som har gått over fristen.
      const overdue = (tasks.data ?? []) as TaskRow[]
      if (overdue.length > 0) {
        const first = overdue[0]
        next.push({
          key: "tasks",
          tone: "danger",
          icon: FileTextIcon,
          title:
            overdue.length === 1
              ? `«${first.title ?? "Oppgave"}» er over fristen`
              : `${overdue.length} oppgaver er over fristen`,
          meta: `Eldste forfalt ${dayText(daysSince(first.due_date))}`,
          href: `/prosjekter/${first.project_id}?tab=arbeid&sub=oppgaver`,
          action: "Åpne oppgavene",
        })
      }

      // 4. Åpne avvik.
      const openDeviations = deviations.count ?? 0
      if (openDeviations > 0) {
        next.push({
          key: "deviations",
          tone: "warning",
          icon: ShieldAlertIcon,
          title: `${openDeviations} ${openDeviations === 1 ? "avvik er" : "avvik er"} fortsatt åpne`,
          meta: "Lukkes med tiltak og dokumentasjon",
          href: "/avvik",
          action: "Se avvikene",
        })
      }

      setItems(next.slice(0, MAX_ROWS))
    }

    load(companyId).catch((error) => {
      reportClientError(error, { context: { action: "hente «Venter på deg»" } })
      if (!cancelled) setItems([])
    })

    return () => {
      cancelled = true
    }
  }, [companyId, isWorker])

  if (loadingRole || items === null) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Venter på deg</h2>
        {items.length > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
            {items.length}
          </span>
        )}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          Forsvinner av seg selv når det er gjort
        </span>
      </header>

      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <CheckIcon className="size-4 text-[color:var(--tone-success)]" />
          Ingenting står og venter. Alt er ajour.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const tone = TONE_STYLE[item.tone]
            const Icon = item.icon
            return (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
                  style={{ background: tone.bg }}
                >
                  <Icon className="size-4" style={{ color: tone.fg }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.meta}</span>
                </span>
                <Button asChild size="sm" className="shrink-0">
                  <Link href={item.href}>{item.action}</Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
