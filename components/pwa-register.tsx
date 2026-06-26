"use client"

import { useEffect } from "react"

import { reportClientError } from "@/lib/errors/client"

/**
 * Registers the service worker so the app is installable as a PWA.
 * Only runs in production to avoid dev-time caching surprises.
 */
export function PwaRegister() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        /* installability is best-effort; just log it for visibility */
        reportClientError(error, { level: "warning", context: { action: "register-service-worker" } })
      })
    }
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
  }, [])

  return null
}
