"use client"

import { useEffect } from "react"

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
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability is best-effort; ignore failures */
      })
    }
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
  }, [])

  return null
}
