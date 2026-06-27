"use client"

import { useEffect } from "react"

import { reportClientError } from "@/lib/errors/client"

const HEARTBEAT_MS = 120_000
// Minimum gap between pings — guards the visibilitychange handler so rapid
// tab-focus toggles can't fire a burst of requests. Well under the 5-min
// "is live now" window, so the active-user count stays accurate.
const MIN_PING_GAP_MS = 60_000

/** Mounted once in the authenticated app shell. Pings the presence endpoint on
 *  mount, on an interval, and whenever the tab becomes visible again — feeding
 *  the live active-user count on Sjefen → Analyse. Fire-and-forget. */
export function PresenceHeartbeat() {
  useEffect(() => {
    let cancelled = false
    let lastPing = 0

    const ping = () => {
      if (cancelled || document.visibilityState === "hidden") return
      const now = Date.now()
      if (now - lastPing < MIN_PING_GAP_MS) return
      lastPing = now
      void fetch("/api/presence/heartbeat", {
        method: "POST",
        keepalive: true,
      }).catch((error) => {
        reportClientError(error, { level: "warning", context: { action: "presence-heartbeat" } })
      })
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
