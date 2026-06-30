"use client"

import { useEffect } from "react"

import { createClient } from "@/lib/supabase/client"
import { isNativeApp, postToNative } from "@/lib/native-bridge"

// Hands the logged-in user's Supabase session to the native shell so its
// background geofencing can authenticate to /api/timeforing/geofence-event.
// No-op on the regular web. Re-sends on token refresh and when the app returns
// to the foreground (tokens are short-lived). Native stores them and starts the
// geofencing; logout posts gps:stop.
export function NativeTrackingBridge() {
  useEffect(() => {
    if (!isNativeApp()) return
    const supabase = createClient()
    let cancelled = false

    async function sendConfig() {
      const { data } = await supabase.auth.getSession()
      const session = data.session
      if (!session?.access_token) return
      postToNative({
        type: "gps:config",
        accessToken: session.access_token,
        refreshToken: session.refresh_token ?? null,
        appUrl: window.location.origin,
      })
    }

    void sendConfig()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (session?.access_token) {
        postToNative({
          type: "gps:config",
          accessToken: session.access_token,
          refreshToken: session.refresh_token ?? null,
          appUrl: window.location.origin,
        })
      } else {
        postToNative({ type: "gps:stop" })
      }
    })

    const onVisible = () => {
      if (document.visibilityState === "visible") void sendConfig()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  return null
}
