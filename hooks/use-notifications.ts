"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"

export interface NotificationItem {
  id: string
  customerId: string
  customerName: string
  content: string
  hasAttachment: boolean
  createdAt: string
  readAt: string | null
}

// How many of the most recent incoming customer messages we surface in the
// notification panel. The unread badge is counted separately (exact) so it
// stays correct even when there are more unread messages than this.
const MAX_NOTIFICATIONS = 30

type MessageRow = {
  id: string
  customer_id: string
  content: string | null
  attachment_url: string | null
  created_at: string
  read_at: string | null
  customers: { name: string | null } | { name: string | null }[] | null
}

function mapRow(row: MessageRow): NotificationItem {
  // PostgREST returns a to-one embed as an object, but the generated types can
  // widen it to an array — handle both shapes defensively.
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: customer?.name?.trim() || "Ukjent kunde",
    content: row.content ?? "",
    hasAttachment: Boolean(row.attachment_url),
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

interface UseNotificationsOptions {
  /** When false the hook stays idle and reports an empty, read state. */
  enabled?: boolean
}

interface UseNotificationsResult {
  notifications: NotificationItem[]
  unreadCount: number
  loading: boolean
  markAllRead: () => Promise<void>
  markThreadRead: (customerId: string) => Promise<void>
}

const EMPTY: NotificationItem[] = []

/**
 * Surfaces incoming customer messages as notifications for the sidebar bell.
 * Keeps a live list of the most recent messages plus an exact unread count,
 * subscribing to realtime changes so the panel and badge stay in sync.
 */
export function useNotifications(
  { enabled = true }: UseNotificationsOptions = {}
): UseNotificationsResult {
  const { user } = useAuth()
  const [supabase] = useState(() => createClient())
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const userId: string | null = user?.id ?? null
  const active = enabled && userId !== null

  const companyIdRef = useRef<string | null>(null)
  // Mirror the latest list into a ref so the mutation callbacks can read it
  // without being re-created on every change (synced in an effect, never read
  // or written during render).
  const notificationsRef = useRef<NotificationItem[]>([])
  useEffect(() => {
    notificationsRef.current = notifications
  }, [notifications])

  const refresh = useCallback(async () => {
    const companyId = companyIdRef.current
    if (!companyId) return

    const [listResult, countResult] = await Promise.all([
      supabase
        .from("messages")
        .select("id, customer_id, content, attachment_url, created_at, read_at, customers(name)")
        .eq("company_id", companyId)
        .eq("sender_type", "customer")
        .order("created_at", { ascending: false })
        .limit(MAX_NOTIFICATIONS),
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("sender_type", "customer")
        .is("read_at", null),
    ])

    if (!listResult.error && listResult.data) {
      setNotifications((listResult.data as MessageRow[]).map(mapRow))
    }
    setUnreadCount(countResult.count ?? 0)
  }, [supabase])

  useEffect(() => {
    if (!active || !userId) {
      companyIdRef.current = null
      return
    }

    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    async function init() {
      const { data } = await supabase
        .from("users")
        .select("company_id")
        .eq("id", userId!)
        .single()

      if (cancelled) return

      const companyId = data?.company_id
      if (!companyId) {
        setLoading(false)
        return
      }
      companyIdRef.current = companyId

      await refresh()
      if (cancelled) return
      setLoading(false)

      channel = supabase
        .channel(`notifications_${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `company_id=eq.${companyId}`,
          },
          () => {
            void refresh()
          }
        )
        .subscribe()
    }

    void init()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [active, userId, refresh, supabase])

  const markThreadRead = useCallback(
    async (customerId: string) => {
      const companyId = companyIdRef.current
      if (!companyId) return

      const unreadInThread = notificationsRef.current.filter(
        (n) => n.customerId === customerId && !n.readAt
      ).length
      if (unreadInThread === 0) return

      const now = new Date().toISOString()
      // Optimistic: clear the unread state immediately, reconcile via refresh().
      setNotifications((prev) =>
        prev.map((n) =>
          n.customerId === customerId && !n.readAt ? { ...n, readAt: now } : n
        )
      )
      setUnreadCount((c) => Math.max(0, c - unreadInThread))

      await supabase
        .from("messages")
        .update({ read_at: now })
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .eq("sender_type", "customer")
        .is("read_at", null)

      void refresh()
    },
    [refresh, supabase]
  )

  const markAllRead = useCallback(async () => {
    const companyId = companyIdRef.current
    if (!companyId) return
    if (notificationsRef.current.every((n) => n.readAt)) return

    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: now }))
    )
    setUnreadCount(0)

    await supabase
      .from("messages")
      .update({ read_at: now })
      .eq("company_id", companyId)
      .eq("sender_type", "customer")
      .is("read_at", null)

    void refresh()
  }, [refresh, supabase])

  // Derive the disabled/logged-out output instead of resetting state inside the
  // effect — keeps the effect free of synchronous setState churn.
  return useMemo<UseNotificationsResult>(
    () => ({
      notifications: active ? notifications : EMPTY,
      unreadCount: active ? unreadCount : 0,
      loading: active ? loading : false,
      markAllRead,
      markThreadRead,
    }),
    [active, notifications, unreadCount, loading, markAllRead, markThreadRead]
  )
}
