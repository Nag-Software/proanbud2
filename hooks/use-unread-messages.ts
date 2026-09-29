"use client"

import { useRoleContext } from "@/components/role-provider"
import { createSharedSource } from "@/lib/client/shared-source"
import { createClient } from "@/lib/supabase/client"

// Én telling og én realtime-kanal per firma, delt av alle som viser tallet
// (bunnmenyen og app-broen er montert samtidig).
const useUnreadForCompany = createSharedSource<number>(0, (companyId, publish) => {
  const supabase = createClient()
  let stopped = false

  async function refreshCount() {
    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("sender_type", "customer")
      .is("read_at", null)
    if (!stopped) publish(count ?? 0)
  }

  void refreshCount()

  const channel = supabase
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

  return () => {
    stopped = true
    void supabase.removeChannel(channel)
  }
})

export function useUnreadMessages() {
  // Firmaet kommer fra rolle-konteksten (hentet én gang per økt, og cachet),
  // i stedet for et eget users-oppslag per instans av hooken.
  const { companyId } = useRoleContext()
  return useUnreadForCompany(companyId)
}
