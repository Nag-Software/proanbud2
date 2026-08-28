"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckIcon,
  FileTextIcon,
  FolderIcon,
  MessageSquareIcon,
  SendIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"

/**
 * «Hele historikken» — tilbud, prosjekter og meldinger for én kunde i én strøm.
 *
 * Poenget er å slippe å lete i tre faner for å svare på «hva har vi gjort for
 * denne kunden, og hva venter». Alt er hentet fra faktiske rader; ingenting
 * utledes eller gjettes.
 */
type Tone = "neutral" | "success" | "danger" | "warning"

type TimelineEvent = {
  key: string
  at: string
  tone: Tone
  icon: LucideIcon
  title: string
  meta: string
  href?: string
}

const TONE_COLOR: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-soft)", fg: "var(--tone-neutral)" },
  success: { bg: "var(--overlay-success)", fg: "var(--tone-success)" },
  danger: { bg: "var(--overlay-danger)", fg: "var(--tone-danger)" },
  warning: { bg: "var(--overlay-warning)", fg: "var(--tone-warning)" },
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS = 14

const nok = new Intl.NumberFormat("no-NO", {
  style: "currency",
  currency: "NOK",
  maximumFractionDigits: 0,
})

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString("no-NO", { day: "numeric", month: "long", year: "numeric" })

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
}

type OfferRow = {
  id: string
  title: string | null
  status: string | null
  amount_nok: number | null
  created_at: string | null
  sent_at: string | null
  customer_viewed_at: string | null
}

type ProjectRow = {
  id: string
  name: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
}

type MessageRow = {
  id: string
  content: string | null
  sender_type: string | null
  created_at: string | null
}

type FollowUp = { offerId: string; title: string; days: number; opened: boolean }

export function CustomerTimelineTab({ customerId }: { customerId: string }) {
  const [events, setEvents] = React.useState<TimelineEvent[] | null>(null)
  const [followUp, setFollowUp] = React.useState<FollowUp | null>(null)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      const supabase = createClient()
      const [offers, projects, messages] = await Promise.all([
        supabase
          .from("offers")
          .select("id, title, status, amount_nok, created_at, sent_at, customer_viewed_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("projects")
          .select("id, name, status, created_at, updated_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("messages")
          .select("id, content, sender_type, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(5),
      ])

      if (cancelled) return

      const list: TimelineEvent[] = []

      for (const offer of (offers.data ?? []) as OfferRow[]) {
        const amount = offer.amount_nok ? nok.format(offer.amount_nok) : null
        const name = offer.title || "Tilbud"

        if (offer.status === "accepted") {
          list.push({
            key: `offer-acc-${offer.id}`,
            at: offer.created_at ?? "",
            tone: "success",
            icon: CheckIcon,
            title: `Tilbud akseptert · ${name}`,
            meta: [amount].filter(Boolean).join(" · "),
            href: `/tilbud/${offer.id}`,
          })
        } else if (offer.status === "rejected") {
          list.push({
            key: `offer-rej-${offer.id}`,
            at: offer.created_at ?? "",
            tone: "danger",
            icon: XIcon,
            title: `Tilbud avslått · ${name}`,
            meta: [amount].filter(Boolean).join(" · "),
            href: `/tilbud/${offer.id}`,
          })
        } else if (offer.sent_at) {
          const opened = Boolean(offer.customer_viewed_at)
          list.push({
            key: `offer-sent-${offer.id}`,
            at: offer.sent_at,
            tone: opened ? "neutral" : "warning",
            icon: SendIcon,
            title: `Tilbud sendt · ${name}`,
            meta: [amount, opened ? "åpnet av kunden" : "ikke åpnet ennå"]
              .filter(Boolean)
              .join(" · "),
            href: `/tilbud/${offer.id}`,
          })
          // Eldste ubesvarte tilbud styrer oppfølgingskortet.
          const days = daysSince(offer.sent_at)
          if (days >= 3) {
            setFollowUp((prev) =>
              prev && prev.days >= days ? prev : { offerId: offer.id, title: name, days, opened }
            )
          }
        } else {
          list.push({
            key: `offer-draft-${offer.id}`,
            at: offer.created_at ?? "",
            tone: "neutral",
            icon: FileTextIcon,
            title: `Tilbud opprettet · ${name}`,
            meta: [amount, "utkast, ikke sendt"].filter(Boolean).join(" · "),
            href: `/tilbud/${offer.id}`,
          })
        }
      }

      for (const project of (projects.data ?? []) as ProjectRow[]) {
        const name = project.name || "Prosjekt"
        if (project.created_at) {
          list.push({
            key: `proj-${project.id}`,
            at: project.created_at,
            tone: "neutral",
            icon: FolderIcon,
            title: `Prosjekt opprettet · ${name}`,
            meta: "",
            href: `/prosjekter/${project.id}`,
          })
        }
        if (project.status === "completed" && project.updated_at) {
          list.push({
            key: `proj-done-${project.id}`,
            at: project.updated_at,
            tone: "success",
            icon: CheckIcon,
            title: `Prosjekt fullført · ${name}`,
            meta: "",
            href: `/prosjekter/${project.id}`,
          })
        }
      }

      for (const message of (messages.data ?? []) as MessageRow[]) {
        if (!message.created_at) continue
        const fromCustomer = message.sender_type === "customer"
        list.push({
          key: `msg-${message.id}`,
          at: message.created_at,
          tone: "neutral",
          icon: MessageSquareIcon,
          title: fromCustomer ? "Melding fra kunden" : "Melding sendt",
          meta: (message.content ?? "").slice(0, 70),
        })
      }

      list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      setEvents(list.slice(0, MAX_EVENTS))
    }

    load().catch((error) => {
      reportClientError(error, { context: { action: "hente kundehistorikk", customerId } })
      if (!cancelled) setEvents([])
    })

    return () => {
      cancelled = true
    }
  }, [customerId])

  if (events === null) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      {followUp && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
            style={{ background: "var(--overlay-warning)" }}
          >
            <SendIcon className="size-4" style={{ color: "var(--tone-warning)" }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {followUp.opened
                ? `«${followUp.title}» er lest, men ikke besvart`
                : `«${followUp.title}» er ikke åpnet av kunden`}
            </span>
            <span className="block text-xs text-muted-foreground">
              Sendt for {followUp.days} dager siden
            </span>
          </span>
          <Button asChild size="sm" className="shrink-0">
            <Link href={`/tilbud/${followUp.offerId}`}>Følg opp</Link>
          </Button>
        </div>
      )}

      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Ingenting har skjedd med denne kunden ennå.
        </p>
      ) : (
        <ol className="space-y-0">
          {events.map((event, index) => {
            const tone = TONE_COLOR[event.tone]
            const Icon = event.icon
            const isLast = index === events.length - 1
            const body = (
              <span className="flex min-w-0 flex-col gap-0.5 pb-4">
                <span className="text-sm font-semibold">{event.title}</span>
                <span className="text-xs text-muted-foreground">
                  {[event.at ? dateText(event.at) : null, event.meta || null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            )

            return (
              <li key={event.key} className="flex gap-3">
                <span className="flex flex-col items-center">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: tone.bg }}
                  >
                    <Icon className="size-3.5" style={{ color: tone.fg }} />
                  </span>
                  {!isLast && <span className="w-px flex-1 bg-border" />}
                </span>
                {event.href ? (
                  <Link
                    href={event.href}
                    className={cn("min-w-0 flex-1 rounded-md transition-colors hover:text-foreground")}
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1">{body}</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
