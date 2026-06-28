"use client"

import { useCallback, useEffect, useState } from "react"
import type { SortDir, SortKey, ViewMode, ViewPrefs } from "../types"

const STORAGE_KEY = "dokumenter:prefs"

const DEFAULTS: ViewPrefs = { viewMode: "list", sortKey: "name", sortDir: "asc" }

function readPrefs(): ViewPrefs {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ViewPrefs>
    return {
      viewMode: parsed.viewMode === "grid" ? "grid" : "list",
      sortKey: (["name", "modified", "size", "type"] as SortKey[]).includes(parsed.sortKey as SortKey)
        ? (parsed.sortKey as SortKey)
        : "name",
      sortDir: parsed.sortDir === "desc" ? "desc" : "asc",
    }
  } catch {
    return DEFAULTS
  }
}

export function useViewPrefs() {
  // Start from DEFAULTS so SSR and first client render agree, then hydrate from storage.
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULTS)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration after mount
    setPrefs(readPrefs())
  }, [])

  const persist = useCallback((next: ViewPrefs) => {
    setPrefs(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [])

  const setViewMode = useCallback((viewMode: ViewMode) => persist({ ...readPrefs(), viewMode }), [persist])

  const toggleViewMode = useCallback(
    () => setPrefs((p) => {
      const next: ViewPrefs = { ...p, viewMode: p.viewMode === "list" ? "grid" : "list" }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    }),
    []
  )

  /** Toggle direction when clicking the active column, else switch key (asc default). */
  const setSort = useCallback(
    (key: SortKey) =>
      setPrefs((p) => {
        const next: ViewPrefs =
          p.sortKey === key
            ? { ...p, sortDir: p.sortDir === "asc" ? "desc" : "asc" }
            : { ...p, sortKey: key, sortDir: "asc" }
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      }),
    []
  )

  const setSortDir = useCallback((sortDir: SortDir) => persist({ ...readPrefs(), sortDir }), [persist])

  return { ...prefs, setViewMode, toggleViewMode, setSort, setSortDir }
}
