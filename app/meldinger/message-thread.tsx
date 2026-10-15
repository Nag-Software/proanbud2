"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { ArrowLeft, Download, FileIcon, Info, MessageSquare, Phone } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { FileViewerOverlay } from "@/components/file-viewer-overlay"
import { cn } from "@/lib/utils"
import {
  groupByDay,
  isImageAttachment,
  type InboxCustomer,
  type InboxMessage,
  type InboxOffer,
  type OfferStatus,
} from "@/lib/meldinger/inbox"
import { initials } from "./conversation-list"

/** Samme ord og farger som tilbudslisten (components/tilbud/columns.tsx). */
export const OFFER_STATUS: Record<OfferStatus, { label: string; dotClass: string }> = {
  draft: { label: "Utkast", dotClass: "bg-[var(--tone-neutral)]" },
  sent: { label: "Sendt", dotClass: "bg-[var(--tone-warning)]" },
  accepted: { label: "Godkjent", dotClass: "bg-[var(--tone-success)]" },
  rejected: { label: "Avvist", dotClass: "bg-[var(--tone-danger)]" },
}

export function MessageThread({
  customer,
  messages,
  offers,
  headerOffer,
  onBack,
  onShowDetails,
  now,
  children,
}: {
  customer: InboxCustomer
  messages: InboxMessage[]
  offers: InboxOffer[]
  /** Tilbudet svaret går til — vises under navnet. */
  headerOffer: InboxOffer | null
  onBack: () => void
  onShowDetails: () => void
  now: Date
  /** Svarfeltet. */
  children: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<{ name: string; url: string } | null>(null)
  const groups = useMemo(() => groupByDay(messages, now), [messages, now])
  const offerTitle = useMemo(() => new Map(offers.map((o) => [o.id, o.title])), [offers])
  // Tilbudsnavn på boblene bare når samtalen faktisk spenner over flere tilbud.
  const multipleOffers = useMemo(
    () => new Set(messages.map((m) => m.offer_id).filter(Boolean)).size > 1,
    [messages]
  )

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, customer.id])

  return (
    <section aria-label={`Samtale med ${customer.name}`} className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 md:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden [@media(pointer:coarse)]:size-11"
          onClick={onBack}
          aria-label="Tilbake til samtaler"
        >
          <ArrowLeft />
        </Button>
        <Avatar className="size-9 rounded-full">
          <AvatarFallback className="rounded-full bg-primary/10 text-xs font-medium text-primary">
            {initials(customer.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{customer.name}</h2>
          {headerOffer ? (
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <span className="truncate">{headerOffer.title}</span>
              <span aria-hidden="true">·</span>
              <span className={cn("size-1.5 shrink-0 rounded-full", OFFER_STATUS[headerOffer.status].dotClass)} aria-hidden="true" />
              <span className="shrink-0">{OFFER_STATUS[headerOffer.status].label}</span>
            </p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{customer.email || customer.phone || "Kunde"}</p>
          )}
        </div>
        {customer.phone && (
          <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground [@media(pointer:coarse)]:size-11">
            <a href={`tel:${customer.phone.replace(/\s+/g, "")}`} aria-label={`Ring ${customer.name}`} title={`Ring ${customer.phone}`}>
              <Phone />
            </a>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground xl:hidden [@media(pointer:coarse)]:size-11"
          onClick={onShowDetails}
          aria-label="Vis kunde og tilbud"
          title="Kunde og tilbud"
        >
          <Info />
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-3 py-4 md:px-6">
        {messages.length === 0 ? (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <MessageSquare aria-hidden="true" className="mx-auto mb-3 size-7 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">Skriv første melding</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {headerOffer
                ? `${customer.name} ser meldingen på tilbudet «${headerOffer.title}».`
                : `${customer.name} har ikke fått et tilbud ennå, så det er ingen side meldingen kan vises på.`}
            </p>
          </div>
        ) : (
          <ol className="mx-auto flex w-full max-w-3xl flex-col" aria-label="Meldinger">
            {groups.map((group) => (
              <li key={group.key} className="flex flex-col">
                <div className="sticky top-0 z-10 my-3 flex justify-center first:mt-0">
                  <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {group.label}
                  </span>
                </div>
                <ol className="flex flex-col">
                  {group.bubbles.map(({ message: msg, startsRun, endsRun }) => {
                    const mine = msg.sender_type === "company"
                    const time = format(new Date(msg.created_at), "HH:mm", { locale: nb })
                    return (
                      <li
                        key={msg.id}
                        className={cn("flex flex-col", mine ? "items-end" : "items-start", startsRun ? "mt-3 first:mt-0" : "mt-0.5")}
                      >
                        <span className="sr-only">{mine ? "Du" : customer.name}, kl. {time}:</span>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-[12px] px-3 py-2 text-sm sm:max-w-[70%]",
                            mine
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-background text-foreground",
                            mine && !endsRun && "rounded-br-[4px]",
                            !mine && !endsRun && "rounded-bl-[4px]"
                          )}
                        >
                          {isImageAttachment(msg) && (
                            <button
                              type="button"
                              onClick={() => setViewer({ name: msg.attachment_name || "Bilde", url: msg.attachment_url! })}
                              className="-mx-1 -mt-0.5 mb-1.5 block overflow-hidden rounded-[8px]"
                              aria-label={`Vis bilde ${msg.attachment_name || ""}`.trim()}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.attachment_url!}
                                alt={msg.attachment_name || "Bildevedlegg"}
                                className="max-h-60 max-w-full object-cover transition-opacity hover:opacity-90"
                              />
                            </button>
                          )}
                          {msg.attachment_url && !isImageAttachment(msg) && (
                            <a
                              href={msg.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className={cn(
                                "mb-1.5 flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 py-2 transition-colors",
                                mine
                                  ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                                  : "border border-border bg-muted/40 hover:bg-muted"
                              )}
                            >
                              <FileIcon className="size-4 shrink-0" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium">{msg.attachment_name || "Vedlegg"}</span>
                              <Download className="size-4 shrink-0 opacity-80" aria-hidden="true" />
                              <span className="sr-only">Last ned</span>
                            </a>
                          )}
                          {msg.content && <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>}
                        </div>
                        {endsRun && (
                          <span aria-hidden="true" className="mt-1 px-1 text-[11px] text-muted-foreground tabular-nums">
                            {time}
                            {multipleOffers && msg.offer_id && offerTitle.get(msg.offer_id) ? ` · ${offerTitle.get(msg.offer_id)}` : ""}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>

      {children}

      {viewer && <FileViewerOverlay name={viewer.name} url={viewer.url} onClose={() => setViewer(null)} />}
    </section>
  )
}
