"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangleIcon,
  BanknoteIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  PlugZapIcon,
  ReceiptIcon,
  XIcon,
  SendIcon,
  ShieldAlertIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"
import { useUserRole } from "@/hooks/use-user-role"
import { computeUninvoicedProjects } from "@/lib/fakturering/uninvoiced"
import {
  WAITING_PRIORITY,
  describeFikenSetupIssue,
  isBankAccountUnverifiedError,
  isDismissed,
  DASHBOARD_DISMISS_DAYS,
  selectBlockingSyncFailures,
  selectExpiringOffers,
  selectOverdueInvoices,
  selectUnansweredChangeOrders,
  selectUnsentInvoices,
  selectViewedUnansweredOffers,
} from "@/lib/dashboard/waiting-signals"
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
  /** Lavere = viktigere. Se WAITING_PRIORITY. Uten dette avgjør spørringsrekkefølgen. */
  priority: number
  tone: Tone
  iconName: IconName
  title: string
  meta: string
  href: string
  action: string
}

/**
 * Ikoner slås opp via navn i stedet for å lagres som komponent, slik at en rad kan
 * serialiseres til localStorage. Uten det kan ikke dashbordet males med en gang.
 */
const ICONS = {
  alert: AlertTriangleIcon,
  clock: ClockIcon,
  file: FileTextIcon,
  shield: ShieldAlertIcon,
  receipt: ReceiptIcon,
  banknote: BanknoteIcon,
  plug: PlugZapIcon,
  send: SendIcon,
} as const

type IconName = keyof typeof ICONS

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  warning: { bg: "var(--overlay-warning)", fg: "var(--tone-warning)" },
  info: { bg: "var(--overlay-info)", fg: "var(--tone-info)" },
  danger: { bg: "var(--overlay-danger)", fg: "var(--tone-danger)" },
  success: { bg: "var(--overlay-success)", fg: "var(--tone-success)" },
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ROWS = 4

/**
 * Øyeblikksbilde i localStorage, samme mønster som resten av dashbordet (pa_dash_v1).
 * Radene males med en gang fra forrige besøk, og byttes ut når ferske data lander.
 * Lista er uansett en påminnelse, ikke en kilde til sannhet — et par sekunder gamle
 * rader er langt bedre enn en tom boks mens elleve spørringer kjører.
 */
const SIGNALS_CACHE_PREFIX = "pa_signals_v1:"

type SignalsSnapshot = { items: WaitingItem[]; hidden: number; isWorker: boolean }

function readSignalsCache(companyId: string): SignalsSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SIGNALS_CACHE_PREFIX + companyId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SignalsSnapshot>
    if (!Array.isArray(parsed.items)) return null
    return {
      items: parsed.items,
      hidden: Number(parsed.hidden) || 0,
      isWorker: parsed.isWorker === true,
    }
  } catch {
    return null
  }
}

function writeSignalsCache(companyId: string, snapshot: SignalsSnapshot) {
  try {
    window.localStorage.setItem(SIGNALS_CACHE_PREFIX + companyId, JSON.stringify(snapshot))
  } catch {
    // Full eller avslått lagring skal aldri velte dashbordet.
  }
}

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
    priority: 0,
    tone: "warning",
    iconName: "alert",
    title: "Bad og våtrom, Storgata 14 er ikke åpnet av kunden",
    meta: "Sendt for 6 dager siden · 148 000 kr · Berg Eiendom AS",
    href: "#",
    action: "Følg opp",
  },
  {
    key: "mock-hours",
    priority: 0,
    tone: "info",
    iconName: "clock",
    title: "12 timer venter på godkjenning",
    meta: "3 føringer",
    href: "#",
    action: "Se og godkjenn",
  },
  {
    key: "mock-tasks",
    priority: 0,
    tone: "danger",
    iconName: "file",
    title: "2 oppgaver er over fristen",
    meta: "Eldste forfalt for 4 dager siden",
    href: "#",
    action: "Åpne oppgavene",
  },
]

export function VenterPaDeg({ companyId }: { companyId: string | null }) {
  const { isWorker } = useUserRole()
  const [items, setItems] = React.useState<WaitingItem[] | null>(null)
  const [hiddenCount, setHiddenCount] = React.useState(0)

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

    // Instant maling fra forrige besøk, før noen spørring har startet.
    // Rollen lagres med: flere rader er skjult for ansatte, og på en delt maskin skal
    // ikke en ansatt få male lederens rader et halvsekund før de byttes ut.
    const cached = readSignalsCache(companyId)
    if (cached && cached.isWorker === isWorker) {
      setItems(cached.items)
      setHiddenCount(cached.hidden)
    }

    let cancelled = false

    async function load(company: string) {
      const supabase = createClient()
      const nowIso = new Date().toISOString()
      const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS).toISOString()

      const [
        offers,
        hours,
        tasks,
        deviations,
        doneProjects,
        invoices,
        syncFailures,
        changeOrders,
        fikenConnection,
        dismissals,
        acceptedOffers,
        acceptedOrders,
        invoiceLines,
      ] = await Promise.all([
        // Ett kall dekker tre tilbudssignaler: ikke åpnet, åpnet uten svar, snart utløpt.
        supabase
          .from("offers")
          .select("id, title, amount_nok, sent_at, customer_viewed_at, quote_valid_until, customers(name)")
          .eq("company_id", company)
          .eq("status", "sent")
          .not("sent_at", "is", null)
          .order("sent_at", { ascending: true })
          .limit(50),
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
        // Ferdige prosjekter er utgangspunktet for «må faktureres» — se
        // lib/fakturering/uninvoiced.ts for hvorfor vi ikke maser om pågående arbeid.
        supabase
          .from("projects")
          .select("id, name, updated_at, customers(name)")
          .eq("company_id", company)
          .eq("status", "completed")
          .limit(50),
        // Ubetalte og usendte fakturaer i ett kall; forfall regnes ut lokalt.
        supabase
          .from("project_invoices")
          .select("id, status, amount_nok, due_days, sent_at, created_at, project_id, projects(name), customers(name)")
          .eq("company_id", company)
          .in("status", ["draft", "sent"])
          .is("paid_at", null)
          .limit(50),
        // Kun feil som stopper penger — se selectBlockingSyncFailures. Ingen
        // provider-filter: en bedrift har kun ett regnskapssystem tilkoblet om
        // gangen, og hardkodet 'fiken' gjorde Tripletex-feil usynlige på dashbordet.
        supabase
          .from("integration_jobs")
          .select("id, job_type, last_error_message")
          .eq("company_id", company)
          .in("status", ["failed", "dead_letter"])
          .limit(50),
        supabase
          .from("change_orders")
          .select("id, title, amount_nok, sent_at, project_id")
          .eq("company_id", company)
          .eq("status", "sent")
          .not("sent_at", "is", null)
          .is("customer_responded_at", null)
          .limit(50),
        supabase
          .from("fiken_connections")
          .select("sync_state, last_error_message")
          .eq("company_id", company)
          .maybeSingle(),
        supabase.from("dashboard_signal_dismissals").select("signal_key, dismissed_at").limit(50),
        // Grunnlaget for «ferdig, men ikke fakturert». Hentes UTEN prosjekt-filter, så
        // hele dashbordet er én parallell bølge i stedet for to sekvensielle — det var
        // ventingen på prosjekt-id-ene som gjorde lastingen treg.
        supabase
          .from("offers")
          .select("id, project_id, amount_nok")
          .eq("company_id", company)
          .eq("status", "accepted")
          .limit(200),
        supabase
          .from("change_orders")
          .select("id, project_id, amount_nok")
          .eq("company_id", company)
          .eq("status", "accepted")
          .limit(200),
        supabase
          .from("project_invoice_lines")
          .select("source_type, source_id, amount_nok, project_invoices!inner(status)")
          .eq("company_id", company)
          .neq("project_invoices.status", "cancelled")
          .limit(500),
      ])

      if (cancelled) return

      const next: WaitingItem[] = []

      const offerRows = ((offers.data ?? []) as OfferRow[]).map((row) => ({
        ...row,
        amountNok: row.amount_nok,
        sentAt: row.sent_at,
        customerViewedAt: (row as unknown as { customer_viewed_at: string | null }).customer_viewed_at,
        quoteValidUntil: (row as unknown as { quote_valid_until: string | null }).quote_valid_until,
        customerName: customerName(row),
      }))

      // 1. Tilbud kunden ikke har åpnet — det dyreste som står stille.
      const notOpened = offerRows
        .filter((row) => !row.customerViewedAt && row.sentAt && row.sentAt <= threeDaysAgo)
        .slice(0, 3)
      for (const row of notOpened) {
        const who = row.customerName
        const amount = row.amount_nok ? nokFormatter.format(row.amount_nok) : null
        next.push({
          key: `offer-${row.id}`,
          priority: WAITING_PRIORITY.offerNotOpened,
          tone: "warning",
          iconName: "alert",
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
          priority: WAITING_PRIORITY.hours,
          tone: "info",
          iconName: "clock",
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
          priority: WAITING_PRIORITY.tasks,
          tone: "danger",
          iconName: "file",
          title:
            overdue.length === 1
              ? `«${first.title ?? "Oppgave"}» er over fristen`
              : `${overdue.length} oppgaver er over fristen`,
          meta: `Eldste forfalt ${dayText(daysSince(first.due_date))}`,
          href: `/prosjekter/${first.project_id}?tab=arbeid&sub=oppgaver`,
          action: "Åpne oppgavene",
        })
      }

      // 4. Ferdig arbeid som ikke er fakturert. Bare for dem som kan fakturere.
      const projectRows = (doneProjects.data ?? []) as Array<{
        id: string
        name: string | null
        updated_at: string | null
        customers: { name: string | null } | { name: string | null }[] | null
      }>

      if (!isWorker && projectRows.length > 0) {
        {
          const uninvoiced = computeUninvoicedProjects({
            projects: projectRows.map((row) => {
              const c = row.customers
              return {
                id: row.id,
                name: row.name,
                customerName: Array.isArray(c) ? (c[0]?.name ?? null) : (c?.name ?? null),
                completedAt: row.updated_at,
              }
            }),
            offers: (acceptedOffers.data ?? []).map((row) => ({
              id: row.id as string,
              projectId: row.project_id as string | null,
              amountNok: row.amount_nok as number | null,
            })),
            changeOrders: (acceptedOrders.data ?? []).map((row) => ({
              id: row.id as string,
              projectId: row.project_id as string | null,
              amountNok: row.amount_nok as number | null,
            })),
            invoicedLines: (invoiceLines.data ?? []).map((row) => ({
              sourceType: row.source_type as string,
              sourceId: row.source_id as string | null,
              amountNok: row.amount_nok as number | null,
            })),
          })

          if (uninvoiced.length > 0) {
            const first = uninvoiced[0]
            const total = uninvoiced.reduce((sum, row) => sum + row.remainingNok, 0)
            next.push({
              key: "uninvoiced",
              priority: WAITING_PRIORITY.uninvoiced,
              tone: "warning",
              iconName: "receipt",
              title:
                uninvoiced.length === 1
                  ? `${first.projectName} er ferdig, men ikke fakturert`
                  : `${uninvoiced.length} ferdige prosjekter er ikke fakturert`,
              meta: [
                nokFormatter.format(uninvoiced.length === 1 ? first.remainingNok : total),
                uninvoiced.length === 1 ? first.customerName : null,
              ]
                .filter(Boolean)
                .join(" · "),
              href:
                uninvoiced.length === 1
                  ? `/prosjekter/${first.projectId}?tab=okonomi&sub=etterfakturering`
                  : "/prosjekter",
              action: uninvoiced.length === 1 ? "Fakturer" : "Se prosjektene",
            })
          }
        }
      }

      // 5. Åpne avvik.
      const openDeviations = deviations.count ?? 0
      if (openDeviations > 0) {
        next.push({
          key: "deviations",
          priority: WAITING_PRIORITY.deviations,
          tone: "warning",
          iconName: "shield",
          title: `${openDeviations} ${openDeviations === 1 ? "avvik er" : "avvik er"} fortsatt åpne`,
          meta: "Lukkes med tiltak og dokumentasjon",
          href: "/avvik",
          action: "Se avvikene",
        })
      }

      // --- Nye signaler: penger og risiko -------------------------------------
      if (!isWorker) {
        // Fiken-oppsett først: uten dette kan ingenting faktureres i det hele tatt.
        const conn = fikenConnection.data as
          | { sync_state: string; last_error_message: string | null }
          | null
        const setupIssue = describeFikenSetupIssue({
          connected: Boolean(conn && conn.sync_state !== "disconnected"),
          bankAccountUnverified:
            isBankAccountUnverifiedError(conn?.last_error_message) ||
            ((syncFailures.data ?? []) as Array<{ last_error_message?: string | null }>).some((row) =>
              isBankAccountUnverifiedError(row.last_error_message)
            ),
        })
        if (setupIssue) {
          next.push({
            key: "fiken-setup",
            priority: WAITING_PRIORITY.fikenSetup,
            tone: "danger",
            iconName: "plug",
            title: setupIssue.title,
            meta: setupIssue.meta,
            href: "/min-bedrift/fiken",
            action: setupIssue.action,
          })
        }

        const invoiceRows = ((invoices.data ?? []) as Array<Record<string, unknown>>).map((row) => {
          const project = row.projects as { name: string | null } | { name: string | null }[] | null
          const customer = row.customers as { name: string | null } | { name: string | null }[] | null
          return {
            id: String(row.id),
            status: String(row.status),
            amountNok: row.amount_nok as number | null,
            dueDays: row.due_days as number | null,
            sentAt: row.sent_at as string | null,
            createdAt: row.created_at as string | null,
            projectId: String(row.project_id),
            projectName: Array.isArray(project) ? (project[0]?.name ?? null) : (project?.name ?? null),
            customerName: Array.isArray(customer) ? (customer[0]?.name ?? null) : (customer?.name ?? null),
          }
        })

        // Forfalt og ubetalt — arbeid du har gjort OG fakturert, uten å få betalt.
        const overdue = selectOverdueInvoices(invoiceRows)
        if (overdue.length > 0) {
          const first = overdue[0]
          const total = overdue.reduce((sum, row) => sum + Number(row.amountNok ?? 0), 0)
          next.push({
            key: "overdue-invoices",
            priority: WAITING_PRIORITY.overdueInvoice,
            tone: "danger",
            iconName: "banknote",
            title:
              overdue.length === 1
                ? `Faktura til ${first.customerName ?? "kunden"} er forfalt`
                : `${overdue.length} fakturaer er forfalt`,
            meta: [
              nokFormatter.format(overdue.length === 1 ? Number(first.amountNok ?? 0) : total),
              `${first.daysOverdue} dager over forfall`,
            ].join(" · "),
            href: `/prosjekter/${first.projectId}?tab=okonomi&sub=etterfakturering`,
            action: "Følg opp",
          })
        }

        // Registrert, men aldri sendt.
        const unsent = selectUnsentInvoices(invoiceRows)
        if (unsent.length > 0) {
          const first = unsent[0]
          next.push({
            key: "unsent-invoices",
            priority: WAITING_PRIORITY.unsentInvoice,
            tone: "warning",
            iconName: "send",
            title:
              unsent.length === 1
                ? `Faktura for ${first.projectName ?? "prosjektet"} er ikke sendt`
                : `${unsent.length} fakturaer er ikke sendt`,
            meta: [
              nokFormatter.format(
                unsent.reduce((sum, row) => sum + Number(row.amountNok ?? 0), 0)
              ),
              "registrert, men ikke sendt til kunden",
            ].join(" · "),
            href: `/prosjekter/${first.projectId}?tab=okonomi&sub=etterfakturering`,
            action: "Send",
          })
        }

        // Synk som stoppet penger. Modulfeil filtreres bort — de er ikke handlingsbare.
        const blocking = selectBlockingSyncFailures(
          (syncFailures.data ?? []) as Array<{ id: number; job_type: string }>
        )
        if (blocking.length > 0) {
          next.push({
            key: "sync-failures",
            priority: WAITING_PRIORITY.failedSync,
            tone: "danger",
            iconName: "plug",
            title:
              blocking.length === 1
                ? "En faktura nådde ikke regnskapet"
                : `${blocking.length} dokumenter nådde ikke regnskapet`,
            meta: "Synkroniseringen stoppet — kunden har ikke fått dem",
            href: "/min-bedrift/regnskap",
            action: "Se hva som feilet",
          })
        }

        // Tilleggsarbeid uten svar — juridisk risiko, ikke bare glemt oppfølging.
        const unanswered = selectUnansweredChangeOrders(
          ((changeOrders.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id),
            title: row.title as string | null,
            amountNok: row.amount_nok as number | null,
            sentAt: row.sent_at as string | null,
            projectId: row.project_id as string | null,
          }))
        )
        if (unanswered.length > 0) {
          const first = unanswered[0]
          next.push({
            key: "change-orders",
            priority: WAITING_PRIORITY.unansweredChangeOrder,
            tone: "warning",
            iconName: "file",
            title:
              unanswered.length === 1
                ? `«${first.title ?? "Tilleggsarbeid"}» er ikke godkjent av kunden`
                : `${unanswered.length} tilleggsarbeid venter på kundens svar`,
            meta: `Sendt ${dayText(daysSince(first.sentAt))} · ikke start arbeidet før det er godkjent`,
            href: first.projectId
              ? `/prosjekter/${first.projectId}?tab=okonomi&sub=etterfakturering`
              : "/prosjekter",
            action: "Purr kunden",
          })
        }

        // Tilbud kunden har åpnet, men ikke svart på.
        const viewed = selectViewedUnansweredOffers(offerRows)
        if (viewed.length > 0) {
          const first = viewed[0]
          next.push({
            key: "offers-viewed",
            priority: WAITING_PRIORITY.offerViewedNoAnswer,
            tone: "info",
            iconName: "alert",
            title:
              viewed.length === 1
                ? `${first.title || "Tilbudet"} er lest, men ikke besvart`
                : `${viewed.length} leste tilbud er ubesvart`,
            meta: [
              first.amountNok ? nokFormatter.format(first.amountNok) : null,
              `Åpnet ${dayText(daysSince(first.customerViewedAt))}`,
            ]
              .filter(Boolean)
              .join(" · "),
            href: `/tilbud/${first.id}`,
            action: "Følg opp",
          })
        }

        // Tilbud som snart går ut.
        const expiring = selectExpiringOffers(offerRows)
        if (expiring.length > 0) {
          const first = expiring[0]
          next.push({
            key: "offers-expiring",
            priority: WAITING_PRIORITY.offerExpiring,
            tone: "warning",
            iconName: "clock",
            title:
              expiring.length === 1
                ? `${first.title || "Tilbudet"} går ut snart`
                : `${expiring.length} tilbud går ut snart`,
            meta: [
              first.amountNok ? nokFormatter.format(first.amountNok) : null,
              `Gyldig til ${new Date(first.quoteValidUntil as string).toLocaleDateString("no-NO")}`,
            ]
              .filter(Boolean)
              .join(" · "),
            href: `/tilbud/${first.id}`,
            action: "Følg opp",
          })
        }
      }

      // Sorter på konsekvens, ikke på spørringsrekkefølge. Uten dette avgjøres de fire
      // synlige radene av hvilken spørring som tilfeldigvis kom først.
      const hidden = (dismissals.data ?? []) as Array<{ signal_key: string; dismissed_at: string }>
      const visible = next.filter((item) => !isDismissed(item.key, hidden))

      visible.sort((a, b) => a.priority - b.priority)
      const shown = visible.slice(0, MAX_ROWS)
      const hiddenTotal = Math.max(0, visible.length - MAX_ROWS)
      setHiddenCount(hiddenTotal)
      setItems(shown)
      writeSignalsCache(company, { items: shown, hidden: hiddenTotal, isWorker })
    }

    load(companyId).catch((error) => {
      reportClientError(error, { context: { action: "hente «Venter på deg»" } })
      if (!cancelled) setItems([])
    })

    return () => {
      cancelled = true
    }
  }, [companyId, isWorker])

  async function dismissSignal(signalKey: string) {
    // Optimistisk: raden forsvinner med en gang. Feiler lagringen, kommer den tilbake
    // ved neste lasting — bedre enn å la brukeren vente på et nettverkskall for å
    // skjule noe.
    setItems((current) => (current ? current.filter((item) => item.key !== signalKey) : current))
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !companyId) return
      await supabase
        .from("dashboard_signal_dismissals")
        .upsert(
          { user_id: user.id, company_id: companyId, signal_key: signalKey, dismissed_at: new Date().toISOString() },
          { onConflict: "user_id,signal_key" }
        )
    } catch (error) {
      reportClientError(error, { context: { action: "skjule dashbordsignal" } })
    }
  }

  // Har vi et øyeblikksbilde, males det med en gang — skjelettet er kun for
  // førstegangsbesøk.
  if (items === null) {
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
            {items.length + hiddenCount}
          </span>
        )}
        {hiddenCount > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            +{hiddenCount} {hiddenCount === 1 ? "til" : "flere"}
          </span>
        )}
        {hiddenCount === 0 && (
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
            Forsvinner av seg selv når det er gjort
          </span>
        )}
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
            const Icon = ICONS[item.iconName] ?? AlertTriangleIcon
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
                <button
                  type="button"
                  onClick={() => dismissSignal(item.key)}
                  aria-label={`Skjul «${item.title}» i ${DASHBOARD_DISMISS_DAYS} dager`}
                  title={`Skjul i ${DASHBOARD_DISMISS_DAYS} dager`}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
