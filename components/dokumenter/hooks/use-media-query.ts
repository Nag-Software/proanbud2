"use client"

import { useCallback, useSyncExternalStore } from "react"

/** Subscribe to a media query via useSyncExternalStore (SSR-safe, effect-free). */
export function useMediaQuery(query: string, serverDefault = false) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query]
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => serverDefault)
}
