"use client"

import { useEffect, useRef, type RefObject } from "react"

/**
 * Automatisk, stille oppdatering av data som vises — i stedet for en
 * «Oppdater»-knapp.
 *
 * `refresh` kalles når dataene er eldre enn en grense OG faktisk vises:
 * - når elementet kommer til syne (f.eks. man bytter til fanen),
 * - når vinduet/fanen får fokus igjen,
 * - jevnlig så lenge man ser på det.
 * Aldri mens elementet er skjult eller fanen er i bakgrunnen, så en
 * åpnet-men-forlatt fane ikke koster kall.
 *
 * `fetchedAtRef` er når dataene sist ble hentet (epoch ms) — kalleren setter
 * den når ferske data kommer, både fra egne kall og fra serveren.
 */
export function useAutoRefresh(
  refresh: () => void,
  element: HTMLElement | null,
  fetchedAtRef: RefObject<number>,
  { onReturnMs = 20_000, intervalMs = 60_000 }: { onReturnMs?: number; intervalMs?: number } = {}
) {
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    let inView = false
    const refreshIfOlderThan = (maxAgeMs: number) => {
      if (!inView || document.visibilityState !== "visible") return
      if (Date.now() - fetchedAtRef.current < maxAgeMs) return
      refreshRef.current()
    }
    const onReturn = () => refreshIfOlderThan(onReturnMs)

    const observer =
      element && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting
            onReturn()
          })
        : null
    if (element && observer) observer.observe(element)
    else inView = element !== null

    const timer = window.setInterval(() => refreshIfOlderThan(intervalMs), Math.min(15_000, intervalMs))
    window.addEventListener("focus", onReturn)
    document.addEventListener("visibilitychange", onReturn)
    return () => {
      observer?.disconnect()
      window.clearInterval(timer)
      window.removeEventListener("focus", onReturn)
      document.removeEventListener("visibilitychange", onReturn)
    }
  }, [element, fetchedAtRef, onReturnMs, intervalMs])
}
