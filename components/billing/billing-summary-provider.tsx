"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { useAuth } from "@/components/auth-provider"

export type BillingSummary = {
  status?: string
  trial_ends_at?: string | null
  plan_label?: string | null
}

type BillingSummaryContextValue = {
  summary: BillingSummary | null
  loading: boolean
  dismissed: boolean
  dismiss: () => void
  refresh: () => Promise<void>
}

const CACHE_KEY = "proanbud:billing-summary"
const DISMISS_KEY = "proanbud:trial-banner-dismissed"

let memoryCache: BillingSummary | null = null

function readSessionCache(): BillingSummary | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as BillingSummary
  } catch {
    return null
  }
}

function writeSessionCache(summary: BillingSummary) {
  memoryCache = summary
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(summary))
  } catch {
    // ignore quota errors
  }
}

function readDismissed(): boolean {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(DISMISS_KEY) === "1"
}

const BillingSummaryContext = createContext<BillingSummaryContextValue | null>(null)

export function BillingSummaryProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [summary, setSummary] = useState<BillingSummary | null>(() => memoryCache ?? readSessionCache())
  const [loading, setLoading] = useState(() => !memoryCache && !readSessionCache())
  const [dismissed, setDismissed] = useState(readDismissed)

  const refresh = useCallback(async () => {
    if (!user) {
      setSummary(null)
      setLoading(false)
      return
    }

    const hasCached = Boolean(memoryCache ?? readSessionCache())
    if (!hasCached) setLoading(true)

    try {
      const response = await fetch("/api/billing/summary")
      if (!response.ok) return
      const data = (await response.json()) as BillingSummary
      writeSessionCache(data)
      setSummary(data)
    } catch {
      // keep cached value on failure
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setSummary(null)
      setLoading(false)
      return
    }
    void refresh()
  }, [authLoading, refresh, user])

  const dismiss = useCallback(() => {
    setDismissed(true)
    if (typeof window !== "undefined") {
      sessionStorage.setItem(DISMISS_KEY, "1")
    }
  }, [])

  const value = useMemo(
    () => ({
      summary,
      loading,
      dismissed,
      dismiss,
      refresh,
    }),
    [summary, loading, dismissed, dismiss, refresh]
  )

  return <BillingSummaryContext.Provider value={value}>{children}</BillingSummaryContext.Provider>
}

export function useBillingSummary() {
  const context = useContext(BillingSummaryContext)
  if (!context) {
    throw new Error("useBillingSummary must be used within BillingSummaryProvider")
  }
  return context
}
