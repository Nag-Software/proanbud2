"use client"

import { Suspense, useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { captureEvent, initAnalytics } from "@/lib/analytics/posthog"

/**
 * Monterer PostHog for selve appen (kun når NEXT_PUBLIC_POSTHOG_KEY er satt)
 * og sender $pageview manuelt ved rutebytte.
 *
 * Konstanten er inlinet ved build og lik på server og klient, så det
 * betingede treet gir ingen hydration-avvik.
 */
const ANALYTICS_ENABLED = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY)

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAnalytics()
  }, [])

  return (
    <>
      {children}
      {ANALYTICS_ENABLED ? (
        // useSearchParams krever egen <Suspense>-grense i App Router.
        <Suspense fallback={null}>
          <AnalyticsPageView />
        </Suspense>
      ) : null}
    </>
  )
}

function AnalyticsPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname) return
    let url = window.origin + pathname
    const query = searchParams?.toString()
    if (query) url += `?${query}`
    captureEvent("$pageview", { $current_url: url })
  }, [pathname, searchParams])

  return null
}
