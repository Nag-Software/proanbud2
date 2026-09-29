"use client"

import { useAuth } from "@/components/auth-provider"
import { createSharedSource } from "@/lib/client/shared-source"
import { createClient } from "@/lib/supabase/client"

/**
 * Custom window-event navnet /timeforing-siden kan dispatche etter inn-/
 * utstempling, slik at nav-indikatoren oppdaterer seg umiddelbart i samme
 * fane (uten å vente på neste focus/visibility-refetch):
 *
 *   window.dispatchEvent(new Event(WORK_SESSION_CHANGED_EVENT))
 */
export const WORK_SESSION_CHANGED_EVENT = "proanbud:work-session-changed"

// Minimum gap mellom refetches fra focus/visibility — hindrer at raske
// fane-bytter fyrer av en byge av spørringer (samme mønster som
// presence-heartbeat). Ingen intervall-polling.
const MIN_REFRESH_GAP_MS = 30_000

// Én spørring og ett sett lyttere per bruker, delt av sidebaren, bunnmenyen
// og app-broen (tidligere tre parallelle kopier av alt under).
const useActiveSessionForUser = createSharedSource<boolean>(false, (userId, publish) => {
  const supabase = createClient()
  let stopped = false
  let lastFetch = 0

  async function refresh(force = false) {
    const now = Date.now()
    if (!force && now - lastFetch < MIN_REFRESH_GAP_MS) return
    lastFetch = now

    const { data, error } = await supabase
      .from("time_entries")
      .select("id")
      .eq("user_id", userId)
      .is("ended_at", null)
      .limit(1)

    // Ved feil beholdes forrige verdi, så indikatoren aldri vises på usikkert grunnlag.
    if (stopped || error) return
    publish((data?.length ?? 0) > 0)
  }

  void refresh(true)

  const onFocus = () => void refresh()
  const onVisible = () => {
    if (document.visibilityState === "visible") void refresh()
  }
  const onSessionChanged = () => void refresh(true)

  window.addEventListener("focus", onFocus)
  document.addEventListener("visibilitychange", onVisible)
  window.addEventListener(WORK_SESSION_CHANGED_EVENT, onSessionChanged)

  return () => {
    stopped = true
    window.removeEventListener("focus", onFocus)
    document.removeEventListener("visibilitychange", onVisible)
    window.removeEventListener(WORK_SESSION_CHANGED_EVENT, onSessionChanged)
  }
})

/**
 * Har innlogget bruker en aktiv (åpen) timeføringsøkt akkurat nå?
 *
 * Lett klient-hook for nav-indikatorer: én `time_entries`-spørring ved start,
 * pluss refetch når vinduet får fokus / fanen blir synlig igjen, og ved
 * WORK_SESSION_CHANGED_EVENT. Feiler stille. Utlogget bruker har per
 * definisjon ingen aktiv økt.
 */
export function useActiveWorkSession() {
  const { user } = useAuth()
  const userId: string | null = user?.id ?? null
  const hasActiveSession = useActiveSessionForUser(userId)
  return { hasActiveSession: userId ? hasActiveSession : false }
}
