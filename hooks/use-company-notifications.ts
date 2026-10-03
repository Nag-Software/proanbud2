"use client"

import { useCallback, useMemo } from "react"

import { useRoleContext } from "@/components/role-provider"
import { REALTIME_CONNECT_DELAY_MS } from "@/lib/client/realtime-delay"
import { createSharedSource } from "@/lib/client/shared-source"
import { createClient } from "@/lib/supabase/client"

export interface CompanyNotificationItem {
  id: string
  /** 'offer_viewed' | 'offer_email_bounced' (db/109). */
  kind: string
  title: string
  body: string
  href: string | null
  createdAt: string
  readAt: string | null
}

type NotificationRow = {
  id: string
  kind: string
  title: string
  body: string | null
  href: string | null
  created_at: string
  read_at: string | null
}

type NotificationsState = { items: CompanyNotificationItem[]; loading: boolean }

// Bjella viser de nyeste. Ulest-tallet regnes fra de samme radene — merket
// viser uansett «9+», så en egen tellespørring er bortkastet.
const MAX_NOTIFICATIONS = 30

const LOADING: NotificationsState = { items: [], loading: true }
const IDLE: NotificationsState = { items: [], loading: false }

function mapRow(row: NotificationRow): CompanyNotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body ?? "",
    href: row.href,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

type SourceHandle = {
  companyId: string
  supabase: ReturnType<typeof createClient>
  /** Optimistisk endring av lista — avstemmes med refresh(). */
  mutate: (change: (items: CompanyNotificationItem[]) => CompanyNotificationItem[]) => void
  refresh: () => Promise<void>
}

// Kilden som kjører nå, så «marker som lest» kan oppdatere lista med en gang.
let activeSource: SourceHandle | null = null

// Én spørring og én realtime-kanal per firma, delt av alle som viser varslene
// (bjella i sidebaren og prikken på menyknappen er montert samtidig).
const useNotificationsForCompany = createSharedSource<NotificationsState>(LOADING, (companyId, publish) => {
  const supabase = createClient()
  let stopped = false
  let items: CompanyNotificationItem[] = []

  async function refresh() {
    const { data, error } = await supabase
      .from("company_notifications")
      .select("id, kind, title, body, href, created_at, read_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTIFICATIONS)
    if (stopped) return
    if (!error && data) items = (data as NotificationRow[]).map(mapRow)
    publish({ items, loading: false })
  }

  const handle: SourceHandle = {
    companyId,
    supabase,
    mutate(change) {
      items = change(items)
      publish({ items, loading: false })
    },
    refresh,
  }
  activeSource = handle

  void refresh()

  let channel: ReturnType<typeof supabase.channel> | null = null
  const connectTimer = window.setTimeout(() => {
    channel = supabase
      .channel(`company_notifications_${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "company_notifications",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void refresh()
        }
      )
      .subscribe((status) => {
        // Fang opp det som kom mens kanalen ventet med å koble til.
        if (status === "SUBSCRIBED") void refresh()
      })
  }, REALTIME_CONNECT_DELAY_MS)

  return () => {
    stopped = true
    window.clearTimeout(connectTimer)
    if (channel) void supabase.removeChannel(channel)
    if (activeSource === handle) activeSource = null
  }
})

interface UseCompanyNotificationsOptions {
  /** When false the hook stays idle and reports an empty, read state. */
  enabled?: boolean
}

interface UseCompanyNotificationsResult {
  notifications: CompanyNotificationItem[]
  unreadCount: number
  loading: boolean
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

/**
 * Firmaets varsler i bjella: «kunden har åpnet tilbudet» og «tilbudet kom ikke
 * frem». Radene skrives av serveren (lib/notifications/company-notifications);
 * her leses de og markeres som lest. Lesestatus er per firma, som for meldinger.
 */
export function useCompanyNotifications(
  { enabled = true }: UseCompanyNotificationsOptions = {}
): UseCompanyNotificationsResult {
  const { companyId } = useRoleContext()
  const key = enabled ? companyId : null
  const state = useNotificationsForCompany(key)

  const markRead = useCallback(
    async (id: string) => {
      const source = activeSource
      if (!key || !source || source.companyId !== key) return

      const now = new Date().toISOString()
      source.mutate((items) =>
        items.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: now } : item))
      )
      await source.supabase
        .from("company_notifications")
        .update({ read_at: now })
        .eq("company_id", key)
        .eq("id", id)
        .is("read_at", null)
      void source.refresh()
    },
    [key]
  )

  const markAllRead = useCallback(async () => {
    const source = activeSource
    if (!key || !source || source.companyId !== key) return

    const now = new Date().toISOString()
    source.mutate((items) => items.map((item) => (item.readAt ? item : { ...item, readAt: now })))
    await source.supabase
      .from("company_notifications")
      .update({ read_at: now })
      .eq("company_id", key)
      .is("read_at", null)
    void source.refresh()
  }, [key])

  return useMemo<UseCompanyNotificationsResult>(() => {
    const current = key ? state : IDLE
    return {
      notifications: current.items,
      unreadCount: current.items.filter((item) => !item.readAt).length,
      loading: current.loading,
      markRead,
      markAllRead,
    }
  }, [key, state, markRead, markAllRead])
}
