"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"

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

/**
 * Har innlogget bruker en aktiv (åpen) timeføringsøkt akkurat nå?
 *
 * Lett klient-hook for nav-indikatorer: én `time_entries`-spørring på mount,
 * pluss refetch når vinduet får fokus / fanen blir synlig igjen, og ved
 * WORK_SESSION_CHANGED_EVENT. Feiler stille — ved feil beholdes forrige
 * verdi (default false), så indikatoren aldri vises på usikkert grunnlag.
 */
export function useActiveWorkSession() {
  const { user } = useAuth()
  const [hasActiveSession, setHasActiveSession] = useState(false)

  useEffect(() => {
    if (!user) return

    const supabase = createClient()
    const userId = user.id
    let cancelled = false
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

      if (cancelled || error) return
      setHasActiveSession((data?.length ?? 0) > 0)
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
      cancelled = true
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener(WORK_SESSION_CHANGED_EVENT, onSessionChanged)
    }
  }, [user])

  // Utlogget bruker har per definisjon ingen aktiv økt — avledes her i stedet
  // for en synkron setState i effekten.
  return { hasActiveSession: user ? hasActiveSession : false }
}
