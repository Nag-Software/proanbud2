"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { reportClientError } from "@/lib/errors/client"

type NativeAuthPayload = {
  access_token?: string
  refresh_token?: string
}

/**
 * Bridge for the native Expo WebView wrapper. Google blocks OAuth inside embedded
 * WebViews, so the app runs Google login in the system browser and hands the
 * resulting Supabase session back here. The native shell calls
 * `window.__nativeAuth({ access_token, refresh_token })`, which sets the session
 * (writing the same cookies the SSR middleware reads) and reloads into the app.
 *
 * No-op on the regular web (the global is just defined, never called).
 */
export function NativeAuthBridge() {
  useEffect(() => {
    const w = window as typeof window & {
      __nativeAuth?: (payload: NativeAuthPayload) => Promise<void>
    }

    w.__nativeAuth = async (payload) => {
      if (!payload?.access_token || !payload?.refresh_token) return
      try {
        const supabase = createClient()
        const { error } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
        })
        if (!error) {
          window.location.replace("/")
        }
      } catch (error) {
        /* best-effort; the login screen stays put on failure */
        reportClientError(error, { level: "warning", context: { action: "native-auth-set-session" } })
      }
    }

    return () => {
      try {
        delete (window as typeof window & { __nativeAuth?: unknown }).__nativeAuth
      } catch {
        /* ignore */
      }
    }
  }, [])

  return null
}
