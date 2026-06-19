"use client"

import { useEffect } from "react"

const HEARTBEAT_MS = 45_000

/** Mounted once in the authenticated app shell. Pings the presence endpoint on
 *  mount, on an interval, and whenever the tab becomes visible again — feeding
 *  the live active-user count on Sjefen → Analyse. Fire-and-forget. */
export function PresenceHeartbeat() {
  useEffect(() => {
    let cancelled = false

    const ping = () => {
      if (cancelled || document.visibilityState === "hidden") return
      void fetch("/api/presence/heartbeat", {
        method: "POST",
        keepalive: true,
      }).catch(() => {})
    }

    ping()
    const interval = window.setInterval(ping, HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") ping()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  return null
}
