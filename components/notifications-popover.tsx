"use client"

/**
 * Varselbjella: kundemeldinger, tilbudsvarsler og «Nytt i Proanbud» i én liste.
 *
 * Oppbygging:
 *  - Toppen: tittel, «Alle / Uleste» og «Merk alle som lest».
 *  - En ulest nyhet står som et eget kort øverst (lib/nyheter.ts).
 *  - Resten grupperes i «I dag», «I går» og «Tidligere», nyeste først.
 *  - Hver rad har et typeikon, kort relativ tid og en «Merk som lest»-knapp
 *    som kommer fram ved pekeren (alltid synlig på berøringsskjerm).
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { differenceInMinutes, format, isToday, isYesterday } from "date-fns"
import { nb } from "date-fns/locale"
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronRight,
  Eye,
  MessageSquare,
  Sparkles,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { NotificationItem } from "@/hooks/use-notifications"
import type { CompanyNotificationItem } from "@/hooks/use-company-notifications"
import type { NyhetMedStatus } from "@/hooks/use-nyheter"

interface NotificationsPopoverProps {
  /** Innkommende kundemeldinger (grupperes per kunde). */
  notifications: NotificationItem[]
  /** Tilbudsvarsler: kunden åpnet tilbudet / e-posten kom ikke frem. */
  offerNotifications?: CompanyNotificationItem[]
  unreadCount: number
  loading: boolean
  /** Uten Meldinger-funksjonen vises ikke lenken til innboksen. */
  messagesEnabled?: boolean
  onMarkAllRead: () => void
  onMarkThreadRead: (customerId: string) => void
  onMarkNotificationRead?: (id: string) => void
  /** «Nytt i Proanbud»: korte nyheter med lenke til artikkelen (lib/nyheter.ts). */
  nyheter?: NyhetMedStatus[]
  onNyhetLest?: (id: string) => void
}

type Conversation = {
  customerId: string
  customerName: string
  preview: string
  createdAt: string
  unread: number
}

// Meldinger, tilbudsvarsler og nyheter vises i én liste, nyeste først.
type Entry =
  | { type: "conversation"; createdAt: string; unread: boolean; conversation: Conversation }
  | { type: "notification"; createdAt: string; unread: boolean; notification: CompanyNotificationItem }
  | { type: "nyhet"; createdAt: string; unread: boolean; nyhet: NyhetMedStatus }

type Filter = "alle" | "uleste"

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function previewOf(item: NotificationItem) {
  const text = item.content.trim()
  if (text) return text
  return item.hasAttachment ? "Sendte et vedlegg" : "Ny melding"
}

/** «nå», «12 min», «3 t», «I går», «4. okt». */
function relativTid(value: string) {
  const date = new Date(value)
  const minutter = differenceInMinutes(new Date(), date)
  if (minutter < 1) return "nå"
  if (minutter < 60) return `${minutter} min`
  if (isToday(date)) return `${Math.floor(minutter / 60)} t`
  if (isYesterday(date)) return "I går"
  return format(date, "d. MMM", { locale: nb })
}

function gruppeFor(value: string): "I dag" | "I går" | "Tidligere" {
  const date = new Date(value)
  if (isToday(date)) return "I dag"
  if (isYesterday(date)) return "I går"
  return "Tidligere"
}

const nyhetTid = (nyhet: NyhetMedStatus) => `${nyhet.dato}T08:00:00`

export function NotificationsPopover({
  notifications,
  offerNotifications,
  unreadCount,
  loading,
  messagesEnabled = true,
  onMarkAllRead,
  onMarkThreadRead,
  onMarkNotificationRead,
  nyheter,
  onNyhetLest,
}: NotificationsPopoverProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<Filter>("alle")

  // Slå sammen meldingsstrømmen (nyeste først) til én rad per kunde, med
  // nyeste melding som forhåndsvisning og antall uleste i vinduet.
  const conversations = React.useMemo<Conversation[]>(() => {
    const byCustomer = new Map<string, Conversation>()
    for (const item of notifications) {
      const existing = byCustomer.get(item.customerId)
      if (!existing) {
        byCustomer.set(item.customerId, {
          customerId: item.customerId,
          customerName: item.customerName,
          preview: previewOf(item),
          createdAt: item.createdAt,
          unread: item.readAt ? 0 : 1,
        })
      } else if (!item.readAt) {
        existing.unread += 1
      }
    }
    return Array.from(byCustomer.values())
  }, [notifications])

  // En ulest nyhet får eget kort øverst; leste nyheter står i lista som andre varsler.
  const fremhevet = (nyheter ?? []).find((nyhet) => !nyhet.lest) ?? null

  const entries = React.useMemo<Entry[]>(() => {
    const merged: Entry[] = [
      ...conversations.map(
        (conversation): Entry => ({
          type: "conversation",
          createdAt: conversation.createdAt,
          unread: conversation.unread > 0,
          conversation,
        })
      ),
      ...(offerNotifications ?? []).map(
        (notification): Entry => ({
          type: "notification",
          createdAt: notification.createdAt,
          unread: !notification.readAt,
          notification,
        })
      ),
      ...(nyheter ?? [])
        .filter((nyhet) => nyhet.id !== fremhevet?.id)
        .map((nyhet): Entry => ({ type: "nyhet", createdAt: nyhetTid(nyhet), unread: !nyhet.lest, nyhet })),
    ]
    return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [conversations, fremhevet?.id, nyheter, offerNotifications])

  const synlige = filter === "uleste" ? entries.filter((entry) => entry.unread) : entries
  const grupper = React.useMemo(() => {
    const ut: Array<{ navn: string; rader: Entry[] }> = []
    for (const entry of synlige) {
      const navn = gruppeFor(entry.createdAt)
      const siste = ut[ut.length - 1]
      if (siste?.navn === navn) siste.rader.push(entry)
      else ut.push({ navn, rader: [entry] })
    }
    return ut
  }, [synlige])

  function openThread(customerId: string) {
    onMarkThreadRead(customerId)
    setOpen(false)
    router.push(`/meldinger?kunde=${customerId}`)
  }

  function openNotification(notification: CompanyNotificationItem) {
    onMarkNotificationRead?.(notification.id)
    setOpen(false)
    // Bare interne stier — href kommer fra databasen.
    if (notification.href?.startsWith("/")) router.push(notification.href)
  }

  function openInbox() {
    setOpen(false)
    router.push("/meldinger")
  }

  function merkLest(entry: Entry) {
    if (entry.type === "conversation") onMarkThreadRead(entry.conversation.customerId)
    else if (entry.type === "notification") onMarkNotificationRead?.(entry.notification.id)
    else onNyhetLest?.(entry.nyhet.id)
  }

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount)
  const tom = !fremhevet && synlige.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Varsler – ${unreadCount} uleste` : "Varsler"}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-sidebar">
              {badgeLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="right"
        sideOffset={12}
        className="w-[372px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-[14px] p-0 shadow-2xl"
      >
        {/* Toppen: tittel, filter og «merk alle» på én linje. */}
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <h2 className="text-sm font-semibold tracking-tight">Varsler</h2>
          <div className="ml-1 inline-flex rounded-[8px] bg-muted p-0.5" role="tablist" aria-label="Vis">
            {(
              [
                ["alle", "Alle"],
                ["uleste", unreadCount > 0 ? `Uleste ${badgeLabel}` : "Uleste"],
              ] as const
            ).map(([verdi, navn]) => (
              <button
                key={verdi}
                type="button"
                role="tab"
                aria-selected={filter === verdi}
                onClick={() => setFilter(verdi)}
                className={cn(
                  "h-6 rounded-[6px] px-2 text-[11.5px] font-medium transition-colors",
                  filter === verdi ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {navn}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              title="Merk alle som lest"
              className="-mr-1 ml-auto flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Merk alle lest
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col p-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-2">
                <Skeleton className="h-8 w-8 shrink-0 rounded-[9px]" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : tom ? (
          <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
            <div className="mb-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border bg-background shadow-sm">
                {filter === "uleste" ? (
                  <Check className="h-5 w-5 text-foreground/70" />
                ) : (
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </div>
            <p className="text-sm font-semibold text-foreground">
              {filter === "uleste" ? "Alt er lest" : "Ingen varsler ennå"}
            </p>
            <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground">
              {filter === "uleste"
                ? "Du er à jour. Nye meldinger og hendelser på tilbudene dukker opp her."
                : "Meldinger fra kunder og hendelser på tilbudene dine dukker opp her."}
            </p>
          </div>
        ) : (
          // Vanlig rulleliste: ScrollArea-roten begrenset ikke høyden på innholdet,
          // så lange lister gled inn under «Se alle meldinger».
          <div className="max-h-[min(64vh,460px)] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
            <div className="flex flex-col pb-1">
              {fremhevet && (
                <NyhetKort
                  nyhet={fremhevet}
                  onApne={() => {
                    onNyhetLest?.(fremhevet.id)
                    setOpen(false)
                  }}
                  onLukk={() => onNyhetLest?.(fremhevet.id)}
                />
              )}

              {grupper.map((gruppe) => (
                <section key={gruppe.navn} aria-label={gruppe.navn}>
                  <h3 className="px-3 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                    {gruppe.navn}
                  </h3>
                  <div className="px-1">
                    {gruppe.rader.map((entry) => (
                      <Rad
                        key={
                          entry.type === "conversation"
                            ? `melding-${entry.conversation.customerId}`
                            : entry.type === "notification"
                              ? `varsel-${entry.notification.id}`
                              : `nyhet-${entry.nyhet.id}`
                        }
                        entry={entry}
                        onApne={() => {
                          if (entry.type === "conversation") openThread(entry.conversation.customerId)
                          else if (entry.type === "notification") openNotification(entry.notification)
                          else {
                            onNyhetLest?.(entry.nyhet.id)
                            setOpen(false)
                          }
                        }}
                        onMerkLest={() => merkLest(entry)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {messagesEnabled && (
          <button
            type="button"
            onClick={openInbox}
            className="flex w-full shrink-0 items-center justify-center gap-1.5 border-t border-border/70 bg-popover px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Se alle meldinger
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Ulest nyhet: et lavt kort øverst, så den ikke drukner blant varslene. */
function NyhetKort({ nyhet, onApne, onLukk }: { nyhet: NyhetMedStatus; onApne: () => void; onLukk: () => void }) {
  return (
    <div className="px-2 pt-2">
      <div className="flex items-center gap-2.5 rounded-[10px] border bg-gradient-to-r from-primary/[0.07] to-transparent py-2 pl-2.5 pr-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{nyhet.tittel}</p>
          {/* <a>, ikke window.open — som hjelpesenter-lenken i brukermenyen. */}
          <a
            href={nyhet.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onApne}
            className="mt-0.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-primary hover:underline"
          >
            Les hva som er nytt
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <button
          type="button"
          onClick={onLukk}
          aria-label="Skjul nyheten"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function Rad({ entry, onApne, onMerkLest }: { entry: Entry; onApne: () => void; onMerkLest: () => void }) {
  const unread = entry.unread
  let ikon: React.ReactNode
  let tittel: string
  let tekst: string | null
  let ekstern: string | null = null

  if (entry.type === "conversation") {
    const { conversation } = entry
    ikon = (
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted text-[11px] font-semibold text-foreground/70">
        {initialsOf(conversation.customerName)}
      </span>
    )
    tittel = conversation.customerName
    tekst = conversation.unread > 1 ? `${conversation.unread} nye · ${conversation.preview}` : conversation.preview
  } else if (entry.type === "notification") {
    const { notification } = entry
    const isBounce = notification.kind === "offer_email_bounced"
    const Ikon = isBounce ? AlertTriangle : Eye
    ikon = (
      <span
        // Nøytral flis som de andre; bare feil (e-posten kom ikke frem) får farge, på ikonet.
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted",
          isBounce ? "text-[var(--tone-danger-strong)]" : "text-foreground/70"
        )}
      >
        <Ikon className="h-3.5 w-3.5" aria-hidden />
      </span>
    )
    tittel = notification.title
    tekst = notification.body || null
  } else {
    ikon = (
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted text-foreground/70">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
      </span>
    )
    tittel = entry.nyhet.tittel
    tekst = entry.nyhet.tekst
    ekstern = entry.nyhet.href
  }

  const innhold = (
    <>
      <div className="relative shrink-0">{ikon}</div>
      <div className="min-w-0 flex-1 pr-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-[13px] leading-tight text-foreground", unread ? "font-semibold" : "font-medium")}>
            {tittel}
          </span>
          <span className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-medium text-primary" : "text-muted-foreground")}>
            {relativTid(entry.createdAt)}
          </span>
        </div>
        {tekst && (
          <p className={cn("mt-0.5 truncate text-xs leading-snug", unread ? "text-foreground/75" : "text-muted-foreground")}>
            {tekst}
          </p>
        )}
      </div>
    </>
  )

  const klasse = cn(
    "flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-accent/10 hover:outline-1 outline-accent",
    unread && "bg-primary/[0.035]"
  )

  return (
    <div className="group relative">
      {ekstern ? (
        <a href={ekstern} target="_blank" rel="noopener noreferrer" onClick={onApne} className={klasse}>
          {innhold}
        </a>
      ) : (
        <button type="button" onClick={onApne} className={klasse}>
          {innhold}
        </button>
      )}
      {/* Ulest: prikk til høyre, som blir til «Merk som lest» ved pekeren. */}
      {unread && (
        <button
          type="button"
          onClick={onMerkLest}
          aria-label={`Merk «${tittel}» som lest`}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-background"
        >
          <span className="h-2 w-2 rounded-full bg-primary group-hover:hidden pointer-coarse:hidden" aria-hidden />
          <Check className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:block pointer-coarse:block" aria-hidden />
        </button>
      )}
    </div>
  )
}
