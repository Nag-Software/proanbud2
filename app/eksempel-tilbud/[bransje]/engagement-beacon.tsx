"use client"

import * as React from "react"

/**
 * Førstepartsmåling av ekte klikk.
 *
 * Lenkeskannere (Safe Links, Proofpoint, antivirus i gateway) henter hver
 * eneste URL i en e-post før mottakeren ser den. Et GET-treff er derfor ikke et
 * klikk. Denne beaconen fyrer først når siden faktisk har vært SYNLIG i tre
 * sekunder, eller når noen ruller eller trykker — og det gjør ingen skanner.
 *
 * Uten `?r=`-token gjør komponenten ingenting: den offentlige eksempelsiden
 * skal ikke sende beacons for tilfeldige besøkende fra Google.
 */
export function EngagementBeacon({ token }: { token: string | null }) {
  React.useEffect(() => {
    if (!token) return

    let visibleSince = document.visibilityState === "visible" ? Date.now() : 0
    let visibleMs = 0
    let sent = false

    const send = (event: "visning" | "interaksjon") => {
      if (sent) return
      sent = true
      const dwell = visibleMs + (visibleSince ? Date.now() - visibleSince : 0)
      const body = JSON.stringify({ token, event, dwell_ms: Math.round(dwell) })

      // sendBeacon overlever at siden lukkes; fetch er reserven.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/outreach/engagement",
          new Blob([body], { type: "application/json" }),
        )
      } else {
        void fetch("/api/outreach/engagement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {})
      }
    }

    const onInteract = () => send("interaksjon")
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        visibleSince = Date.now()
      } else if (visibleSince) {
        visibleMs += Date.now() - visibleSince
        visibleSince = 0
      }
    }

    const timer = window.setTimeout(() => send("visning"), 3200)
    window.addEventListener("scroll", onInteract, { once: true, passive: true })
    window.addEventListener("pointerdown", onInteract, { once: true })
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("scroll", onInteract)
      window.removeEventListener("pointerdown", onInteract)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [token])

  return null
}
