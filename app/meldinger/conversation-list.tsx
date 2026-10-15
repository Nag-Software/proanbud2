"use client"

import { Loader2, MessageSquare, PenSquare, RefreshCw, Search, X } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  listTime,
  previewText,
  type Conversation,
  type InboxFilter,
} from "@/lib/meldinger/inbox"

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "unread", label: "Uleste" },
  { value: "needs_reply", label: "Må svares" },
]

export function ConversationList({
  conversations,
  totalCount,
  counts,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  selectedCustomerId,
  onSelect,
  onNewMessage,
  onRefresh,
  isRefreshing,
  now,
}: {
  conversations: Conversation[]
  totalCount: number
  counts: { unread: number; needsReply: number }
  filter: InboxFilter
  onFilterChange: (filter: InboxFilter) => void
  query: string
  onQueryChange: (query: string) => void
  selectedCustomerId: string | null
  onSelect: (customerId: string) => void
  onNewMessage: () => void
  onRefresh: () => void
  isRefreshing: boolean
  now: Date
}) {
  const countFor = (value: InboxFilter) =>
    value === "unread" ? counts.unread : value === "needs_reply" ? counts.needsReply : 0

  return (
    <aside
      aria-label="Samtaler"
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-border bg-card",
        "w-full md:w-[320px] md:shrink-0 lg:w-[340px]",
        selectedCustomerId && "hidden md:flex"
      )}
    >
      <div className="shrink-0 space-y-2.5 border-b border-border px-3 py-3">
        <div className="flex items-center gap-1">
          <h1 className="flex-1 text-base font-semibold tracking-tight">Meldinger</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Hent nye meldinger"
            title="Hent nye meldinger"
            className="text-muted-foreground [@media(pointer:coarse)]:size-11"
          >
            {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onNewMessage}
            className="[@media(pointer:coarse)]:min-h-11"
          >
            <PenSquare />
            Ny melding
          </Button>
        </div>

        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Søk i samtaler"
            placeholder="Søk kunde, tilbud eller tekst"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="h-9 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden [@media(pointer:coarse)]:min-h-11"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Tøm søket"
              className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div role="group" aria-label="Vis samtaler" className="flex gap-1">
          {FILTERS.map(({ value, label }) => {
            const active = filter === value
            const count = countFor(value)
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[5px] border px-2.5 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-11",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-foreground hover:bg-muted"
                )}
              >
                {label}
                {count > 0 && (
                  <span
                    className={cn(
                      "tabular-nums",
                      active ? "text-background/80" : "text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <EmptyList filter={filter} hasQuery={Boolean(query.trim())} totalCount={totalCount} onNewMessage={onNewMessage} />
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((conv) => (
              <li key={conv.customer.id}>
                <ConversationRow
                  conv={conv}
                  selected={conv.customer.id === selectedCustomerId}
                  onSelect={onSelect}
                  now={now}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

function ConversationRow({
  conv,
  selected,
  onSelect,
  now,
}: {
  conv: Conversation
  selected: boolean
  onSelect: (customerId: string) => void
  now: Date
}) {
  const unread = conv.unreadCount > 0
  return (
    <button
      type="button"
      onClick={() => onSelect(conv.customer.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-h-[64px] w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
        selected ? "bg-muted/70 shadow-[inset_3px_0_0_var(--primary)]" : "hover:bg-muted/50"
      )}
    >
      <Avatar className="mt-0.5 size-9 rounded-full">
        <AvatarFallback className="rounded-full bg-primary/10 text-xs font-medium text-primary">
          {initials(conv.customer.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {conv.customer.name}
          </span>
          {conv.latestMessage && (
            <span className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
              {listTime(conv.latestMessage.created_at, now)}
            </span>
          )}
        </div>
        {conv.offer && <p className="truncate text-[11px] text-muted-foreground">{conv.offer.title}</p>}
        <div className="mt-0.5 flex items-center gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-xs", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
            {previewText(conv.latestMessage)}
          </p>
          {unread ? (
            <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {conv.unreadCount}
              <span className="sr-only"> uleste</span>
            </span>
          ) : conv.needsReply ? (
            <span className="shrink-0 text-[11px] font-medium text-[var(--tone-warning-strong)] dark:text-amber-300">
              Må svares
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

function EmptyList({
  filter,
  hasQuery,
  totalCount,
  onNewMessage,
}: {
  filter: InboxFilter
  hasQuery: boolean
  totalCount: number
  onNewMessage: () => void
}) {
  let title = "Ingen samtaler ennå"
  let body = "Når en kunde skriver på et tilbud, havner meldingen her. Du kan også skrive først."
  let showCta = true
  if (hasQuery) {
    title = "Ingen treff"
    body = "Prøv et annet navn, tilbud eller ord."
    showCta = false
  } else if (totalCount > 0 && filter === "unread") {
    title = "Ingen uleste"
    body = "Du har lest alt kundene har skrevet."
    showCta = false
  } else if (totalCount > 0 && filter === "needs_reply") {
    title = "Alle er besvart"
    body = "Ingen kunder venter på svar fra deg."
    showCta = false
  }
  return (
    <div className="px-6 py-12 text-center">
      <MessageSquare aria-hidden="true" className="mx-auto mb-3 size-7 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-xs text-muted-foreground">{body}</p>
      {showCta && (
        <Button type="button" variant="outline" size="sm" className="mt-4 [@media(pointer:coarse)]:min-h-11" onClick={onNewMessage}>
          <PenSquare />
          Ny melding
        </Button>
      )}
    </div>
  )
}
