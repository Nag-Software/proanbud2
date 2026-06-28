"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { format, isToday, isYesterday } from "date-fns"
import { nb } from "date-fns/locale"
import { Bell, BellOff, CheckCheck, ChevronRight, MessageSquare } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { NotificationItem } from "@/hooks/use-notifications"

interface NotificationsPopoverProps {
  notifications: NotificationItem[]
  unreadCount: number
  loading: boolean
  onMarkAllRead: () => void
  onMarkThreadRead: (customerId: string) => void
}

type Conversation = {
  customerId: string
  customerName: string
  preview: string
  createdAt: string
  unread: number
}

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

function formatTime(value: string) {
  const date = new Date(value)
  if (isToday(date)) return format(date, "HH:mm", { locale: nb })
  if (isYesterday(date)) return "I går"
  return format(date, "d. MMM", { locale: nb })
}

export function NotificationsPopover({
  notifications,
  unreadCount,
  loading,
  onMarkAllRead,
  onMarkThreadRead,
}: NotificationsPopoverProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  // Collapse the raw message stream (already newest-first) into one row per
  // conversation, keeping the newest message as the preview and tallying the
  // unread messages within the surfaced window.
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

  function openThread(customerId: string) {
    onMarkThreadRead(customerId)
    setOpen(false)
    router.push(`/meldinger?kunde=${customerId}`)
  }

  function openInbox() {
    setOpen(false)
    router.push("/meldinger")
  }

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0 ? `Varsler – ${unreadCount} uleste` : "Varsler"
          }
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
        className="w-[380px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Varsler</h2>
            {unreadCount > 0 && (
              <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary">
                {unreadCount} {unreadCount === 1 ? "ny" : "nye"}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marker alle som lest
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BellOff className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Ingen varsler</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Du er à jour. Nye meldinger fra kunder dukker opp her.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[min(60vh,420px)]">
            <div className="flex flex-col p-1.5">
              {conversations.map((conversation) => {
                const isUnread = conversation.unread > 0
                return (
                  <button
                    key={conversation.customerId}
                    type="button"
                    onClick={() => openThread(conversation.customerId)}
                    className={cn(
                      "group relative flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-accent",
                      isUnread && "bg-primary/[0.04]"
                    )}
                  >
                    <div className="relative shrink-0">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {initialsOf(conversation.customerName)}
                      </span>
                      {isUnread && (
                        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-popover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            isUnread
                              ? "font-semibold text-foreground"
                              : "font-medium text-foreground"
                          )}
                        >
                          {conversation.customerName}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatTime(conversation.createdAt)}
                        </span>
                      </div>
                      <p
                        className={cn(
                          "mt-0.5 line-clamp-2 text-xs leading-relaxed",
                          isUnread
                            ? "text-foreground/80"
                            : "text-muted-foreground"
                        )}
                      >
                        {conversation.preview}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}

        <button
          type="button"
          onClick={openInbox}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Se alle meldinger
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </PopoverContent>
    </Popover>
  )
}
