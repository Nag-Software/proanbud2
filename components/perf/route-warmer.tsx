"use client"

import { usePathname, useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"
import { useEffect, useRef } from "react"

import { useAuth } from "@/components/auth-provider"
import { useUserRole } from "@/hooks/use-user-role"
import { useNavItems } from "@/hooks/use-nav-items"
import { isNativeApp, isNativeAndroid } from "@/lib/native-bridge"
import { createWarmEngine, type WarmEngine } from "@/lib/perf/warm-engine"
import {
  buildWarmPlan,
  parseNavUsage,
  recordVisit,
  selectHotSet,
  usageScore,
  type NavUsage,
} from "@/lib/perf/warm-plan"
import { warmPageData } from "@/lib/perf/page-data-warmers"

/**
 * Bakgrunnsforvarming av appens sider.
 *
 * Når skallet har lastet og nettleseren er ledig, henter vi de sidene
 * brukeren har tilgang til ferdig rendret (full RSC-prefetch) inn i Next sin
 * ruter-cache — så første klikk på hver side vises øyeblikkelig i stedet for
 * å vente på serveren. Rekkefølgen er dagens hovedpunkter, så det brukeren
 * faktisk pleier å åpne, så resten.
 *
 * Mens brukeren er aktiv holdes et lite «varmt sett» (hovedpunktene + de mest
 * brukte sidene) varmt før oppføringene utløper; resten varmes én gang per
 * økt. Forvarmede sider kan være opptil fem minutter gamle — AppPageShell
 * stempler dem, og PageFreshness frisker dem opp stille ved ankomst.
 *
 * Kostnad: hver forvarming er én serverless-kjøring. Det erstatter i praksis
 * den delvise prefetchen Next allerede gjør for synlige lenker, og er uansett
 * begrenset av WARM_BUDGET per fane. Slås av med
 * NEXT_PUBLIC_ROUTE_WARMING=off.
 */

const WARMING_DISABLED = process.env.NEXT_PUBLIC_ROUTE_WARMING === "off"

/** Vent så lenge etter at siden er lastet før første pass — sidens egne kall går først. */
const START_DELAY_MS = 1_500
/** Avstand mellom hver forvarming i et pass, så serveren ikke får alt i ett støt. */
const PACE_MS = 300
/** Hvor ofte vi sjekker om det varme settet trenger påfyll. */
const KEEP_WARM_TICK_MS = 15_000
/** Brukeren regnes som aktiv så lenge siste input er nyere enn dette. */
const ACTIVE_WINDOW_MS = 3 * 60_000
/** Etter at Next har kastet cachen (en endring): vent så lenge med å varme på nytt. */
const QUIET_AFTER_INVALIDATION_MS = 30_000

const USAGE_KEY_PREFIX = "pa_nav_usage_v1:"

function readUsage(userId: string): NavUsage {
  try {
    return parseNavUsage(window.localStorage.getItem(USAGE_KEY_PREFIX + userId))
  } catch {
    return {}
  }
}

function writeUsage(userId: string, usage: NavUsage) {
  try {
    window.localStorage.setItem(USAGE_KEY_PREFIX + userId, JSON.stringify(usage))
  } catch {
    // Privat modus / fullt lager: vi mister bare prioriteringen, ikke forvarmingen.
  }
}

type NetworkInformationLike = { saveData?: boolean; effectiveType?: string }

/** Ingen forvarming på «spar data» eller 2G — der koster hver byte. */
function networkAllowsWarming(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (!connection) return true
  if (connection.saveData) return false
  return !(connection.effectiveType && /2g$/.test(connection.effectiveType))
}

function onIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 3_000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(callback, 200)
  return () => window.clearTimeout(id)
}

export function RouteWarmer() {
  if (WARMING_DISABLED) return null
  return <RouteWarmerInner />
}

function RouteWarmerInner() {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()
  const userId: string | null = user?.id ?? null
  const { role, isWorker, loadingRole, hasFeature, roleKnown } = useUserRole()
  const { navItems } = useNavItems()

  const routerRef = useRef(router)
  routerRef.current = router
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  const lastActiveAtRef = useRef(0)

  // Én motor per bruker — kontobytte på samme maskin starter på nytt.
  const engineRef = useRef<{ userId: string; engine: WarmEngine } | null>(null)
  function getEngine(forUser: string): WarmEngine {
    if (engineRef.current?.userId !== forUser) {
      engineRef.current = {
        userId: forUser,
        engine: createWarmEngine({
          prefetch: (href, onInvalidate) =>
            routerRef.current.prefetch(href, { kind: PrefetchKind.FULL, onInvalidate }),
        }),
      }
    }
    return engineRef.current.engine
  }

  // Besøkshistorikk: styrer rekkefølgen og hvilke sider som holdes varme.
  useEffect(() => {
    if (!userId) return
    writeUsage(userId, recordVisit(readUsage(userId), pathname, Date.now()))
  }, [userId, pathname])

  // Aktivitet: det varme settet fylles bare på mens noen faktisk bruker appen.
  useEffect(() => {
    const markActive = () => {
      lastActiveAtRef.current = Date.now()
    }
    markActive()
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const
    for (const event of events) window.addEventListener(event, markActive, { passive: true })
    return () => {
      for (const event of events) window.removeEventListener(event, markActive)
    }
  }, [])

  // Rolle- og planbildet som styrer hva som er lov å forvarme. Serialisert, så
  // effekten under bare starter på nytt når noe faktisk endrer seg.
  const features = ["kalender", "meldinger", "hms", "avvik", "ks"] as const
  const navKey = roleKnown
    ? JSON.stringify({
        role,
        isWorker,
        loadingRole,
        features: features.filter((feature) => hasFeature(feature)),
      })
    : null
  // På iOS har hver bunnfane sin egen WebView — de sidene varmes der de bor.
  const nativeTabsKey = navItems.map((item) => item.href).join("|")

  useEffect(() => {
    if (!userId || navKey === null) return
    const nav = JSON.parse(navKey) as {
      role: string | null
      isWorker: boolean
      loadingRole: boolean
      features: string[]
    }
    const navContext = {
      role: nav.role,
      isWorker: nav.isWorker,
      loadingRole: nav.loadingRole,
      hasFeature: (feature: string) => nav.features.includes(feature),
    }
    const engine = getEngine(userId)
    const nativeIos = isNativeApp() && !isNativeAndroid()
    const nativeTabs = new Set(nativeTabsKey.split("|"))

    let disposed = false
    // Maks én ventende timer og ett ventende idle-kall om gangen (bare ett pass
    // kjører av gangen), så ingenting hoper seg opp gjennom en lang økt.
    let stepTimer: number | undefined
    let startTimer: number | undefined
    let cancelIdle: (() => void) | null = null
    const scheduleIdle = (callback: () => void) => {
      cancelIdle?.()
      cancelIdle = onIdle(() => {
        cancelIdle = null
        callback()
      })
    }

    function currentPlan() {
      const now = Date.now()
      const usage = readUsage(userId!)
      const projectHrefs = Object.keys(usage)
        .filter((href) => href.startsWith("/prosjekter/"))
        .sort((a, b) => usageScore(usage[b], now) - usageScore(usage[a], now))
      let plan = buildWarmPlan({ nav: navContext, currentPath: pathnameRef.current, usage, projectHrefs, now })
      let hot = selectHotSet(plan, navContext, usage, now)
      if (nativeIos) {
        plan = plan.filter((href) => !nativeTabs.has(href))
        hot = hot.filter((href) => !nativeTabs.has(href))
      }
      return { plan, hot }
    }

    function canWarm() {
      return !disposed && document.visibilityState === "visible" && networkAllowsWarming()
    }

    // Ett pass: varm sidene i rekkefølge, med litt luft mellom hver.
    // `onComplete` kalles bare hvis passet kom helt gjennom lista.
    let passRunning = false
    function runPass(hrefs: string[], onComplete?: () => void) {
      if (passRunning) return
      passRunning = true
      let index = 0
      const step = () => {
        if (!canWarm() || index >= hrefs.length) {
          passRunning = false
          if (index >= hrefs.length) onComplete?.()
          return
        }
        const href = hrefs[index++]
        if (href === pathnameRef.current) {
          step()
          return
        }
        const issued = engine.warm(href)
        if (issued) warmPageData(href, { userId: userId! })
        if (!engine.hasBudget()) {
          passRunning = false
          return
        }
        stepTimer = window.setTimeout(step, issued ? PACE_MS : 0)
      }
      step()
    }

    // Første pass: hele planen, når siden er ferdig lastet og nettleseren ledig.
    // iOS-appen nøyer seg med det varme settet (én WebView per fane). Blir
    // fanen skjult underveis, fullføres passet når den er synlig igjen — sider
    // som allerede er varme hoppes over av motoren.
    let initialDone = false
    const runInitialPass = () => {
      if (initialDone) return
      const { plan, hot } = currentPlan()
      runPass(nativeIos ? hot : plan, () => {
        initialDone = true
      })
    }
    const startInitialPass = () => {
      startTimer = window.setTimeout(() => scheduleIdle(runInitialPass), START_DELAY_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !initialDone) scheduleIdle(runInitialPass)
    }
    document.addEventListener("visibilitychange", onVisible)
    if (document.readyState === "complete") {
      startInitialPass()
    } else {
      window.addEventListener("load", startInitialPass, { once: true })
    }

    // Deretter: hold det varme settet varmt mens brukeren er aktiv. Fanger både
    // utløp (5 min) og at Next har kastet cachen etter en endring.
    const tick = window.setInterval(() => {
      if (Date.now() - lastActiveAtRef.current > ACTIVE_WINDOW_MS) return
      if (engine.msSinceInvalidation() < QUIET_AFTER_INVALIDATION_MS) return
      const { hot } = currentPlan()
      const due = hot.filter((href) => engine.needsWarm(href))
      if (due.length > 0) runPass(due)
    }, KEEP_WARM_TICK_MS)

    return () => {
      disposed = true
      window.clearInterval(tick)
      window.clearTimeout(stepTimer)
      window.clearTimeout(startTimer)
      cancelIdle?.()
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("load", startInitialPass)
    }
  }, [userId, navKey, nativeTabsKey])

  return null
}
