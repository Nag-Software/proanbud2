"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"

export function useUnreadMessages() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!user) {
      setCount(0)
      return
    }

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data } = await supabase
        .from("users")
        .select("company_id")
        .eq("id", user.id)
        .single()

      const companyId = data?.company_id
      if (!companyId) return

      async function refreshCount() {
        const { count: unreadCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("sender_type", "customer")
          .is("read_at", null)
        setCount(unreadCount ?? 0)
      }

      await refreshCount()

      channel = supabase
        .channel(`unread_messages_${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `company_id=eq.${companyId}`,
          },
          () => {
            void refreshCount()
          }
        )
        .subscribe()
    }

    void init()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [user])

  return count
}
