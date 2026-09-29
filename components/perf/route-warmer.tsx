"use client"

import { usePathname, useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"
import { useEffect, useRef } from "react"

import { useAuth } from "@/components/auth-provider"
import { useUserRole } from "@/hooks/use-user-role"
import { useNavItems } from "@/hooks/use-nav-items"
import { isNativeApp, isNativeAndroid } from "@/lib/native-bridge"
import { hasPageDataWarmer, warmPageData } from "@/lib/perf/page-data-warmers"
import { waitForRscRequest } from "@/lib/perf/prefetch-completion"
import { createWarmEngine, type WarmEngine } from "@/lib/perf/warm-engine"
import {
  buildWarmPlan,
  parseNavUsage,
  recordVisit,
  selectHotSet,
  usageScore,
  type NavUsage,
} from "@/lib/perf/warm-plan"

/**
 * Bakgrunnsforvarming av appens sider — som ALLTID viker for brukeren.
 *
 * Sidene brukeren har tilgang til hentes ferdig rendret (full RSC-prefetch)
 * inn i Next sin ruter-cache, så første klikk vises øyeblikkelig. Reglene, i
 * prioritert rekkefølge:
 *
 * 1. Brukeren først. Bakgrunnsarbeid starter først når brukeren har vært i ro
 *    en stund, og pauser i det øyeblikket hen klikker, taster, scroller eller
 *    navigerer. Det går aldri mer enn ÉN bakgrunnsforespørsel om gangen — neste
 *    sendes først når forrige er ferdig — så et klikk konkurrerer i verste
 *    fall med ett kall, aldri med en kø.
 * 2. Det brukeren peker på, hentes straks. Hviler pekeren på en lenke (eller
 *    brukeren trykker på den), forvarmes akkurat den siden utenfor køen, og
 *    navigasjonen gjenbruker svaret som allerede er på vei.
 * 3. Deretter: dagens hovedpunkter, så det brukeren pleier å åpne, så resten
 *    av menyen, og til slutt dataene til sider som henter i nettleseren.
 *
 * Forvarmede sider lever `staleTimes.static` (60 s) i cachen, så de er aldri
 * eldre enn ett minutt når de vises. Mens brukeren er aktiv fornyes et lite
 * «varmt sett» (hovedpunktene + det mest brukte).
 *
 * Kostnad: hver forvarming er én serverless-kjøring, begrenset av
 * WARM_BUDGET per fane. Slås av med NEXT_PUBLIC_ROUTE_WARMING=off, og kjører
 * bare i produksjonsbygg.
 */

// Aldri i utvikling: der er router.prefetch en no-op (Next slår det av for å
// ikke kompilere ruter på forhånd), og datavarmerne ville tvunget dev-serveren
// til å kompilere API-ruter midt i det brukeren faktisk klikker på.
const WARMING_DISABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ROUTE_WARMING === "off"

/** Første bakgrunnsjobb tidligst så lenge etter at dokumentet begynte å laste. */
const MIN_AFTER_LOAD_MS = 2_500
/** Brukeren må ha vært i ro så lenge før bakgrunnsarbeid starter eller fortsetter. */
const IDLE_BEFORE_WORK_MS = 1_500
/** …og så lenge etter en navigasjon (den nye sidens egne kall går først). */
const AFTER_NAVIGATION_MS = 2_000
/** Pause mellom to bakgrunnsjobber. */
const GAP_MS = 150
/** Så lenge pekeren må hvile på en lenke før det regnes som en intensjon. */
const HOVER_INTENT_MS = 80
/** Lengste vi venter på at én forvarming blir ferdig før køen går videre. */
const COMPLETION_TIMEOUT_MS = 4_000
/** Hvor ofte vi sjekker om det varme settet trenger fornyelse. */
const KEEP_WARM_TICK_MS = 5_000
/** Det varme settet fornyes bare så lenge brukeren har vært aktiv nylig. */
const ACTIVE_WINDOW_MS = 90_000
/**
 * Data for klientsider (kalender, dokumenter, mine priser) varmes sjeldnere enn
 * rutene: sidene revaliderer uansett selv ved åpning, og kalenderen koster
 * kall til Google/Outlook.
 */
const DATA_REWARM_MS = 5 * 60_000

const PROJECT_PATH = /^\/prosjekter\/[0-9a-f-]{36}$/i
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

/** Sti for en intern app-lenke under et DOM-element — ellers null. */
function internalLinkPath(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest("a[href]")
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return null
  try {
    const url = new URL(anchor.href)
    return url.origin === window.location.origin ? url.pathname : null
  } catch {
    return null
  }
}

type Task = { href: string; kind: "route" | "data" }

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
  const pathnameRef = useRef(pathname)
  const lastNavigationAtRef = useRef(0)
  // Én motor per bruker — kontobytte på samme maskin starter på nytt.
  const engineRef = useRef<{ userId: string; engine: WarmEngine } | null>(null)

  useEffect(() => {
    routerRef.current = router
  }, [router])

  // Navigasjon: gi den nye siden arbeidsro, regn den som fersk (Next har
  // nettopp hentet den), og registrer besøket for prioriteringen.
  useEffect(() => {
    pathnameRef.current = pathname
    lastNavigationAtRef.current = Date.now()
    if (!userId) return
    if (engineRef.current?.userId === userId) engineRef.current.engine.markFresh(pathname)
    writeUsage(userId, recordVisit(readUsage(userId), pathname, Date.now()))
  }, [userId, pathname])

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
    const forUser: string = userId
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
    if (engineRef.current?.userId !== forUser) {
      engineRef.current = {
        userId: forUser,
        engine: createWarmEngine({
          prefetch: (href, onInvalidate) =>
            routerRef.current.prefetch(href, { kind: PrefetchKind.FULL, onInvalidate }),
        }),
      }
      engineRef.current.engine.markFresh(pathnameRef.current)
    }
    const engine = engineRef.current.engine
    const nativeIos = isNativeApp() && !isNativeAndroid()
    const nativeTabs = new Set(nativeTabsKey.split("|"))

    let disposed = false
    let busy = false
    let lastInteractionAt = 0
    let pumpTimer: number | undefined
    let hoverTimer: number | undefined
    const queue: Task[] = []
    const dataWarmedAt = new Map<string, number>()

    function currentPlan() {
      const now = Date.now()
      const usage = readUsage(forUser)
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

    // Menypunkter brukeren har tilgang til, pluss prosjektsider (lista viser
    // bare prosjekter man har tilgang til).
    const allowed = new Set(currentPlan().plan)
    const isWarmable = (href: string) => allowed.has(href) || PROJECT_PATH.test(href)

    /** Millisekunder til bakgrunnsarbeid er lov (0 = nå), eller null når det ikke skal skje nå. */
    function backgroundWaitMs(now: number): number | null {
      if (disposed || document.visibilityState !== "visible" || !networkAllowsWarming()) return null
      if (!engine.hasBudget(now)) return null
      if (document.readyState !== "complete") return 500
      return Math.max(
        0,
        performance.timeOrigin + MIN_AFTER_LOAD_MS - now,
        lastInteractionAt + IDLE_BEFORE_WORK_MS - now,
        lastNavigationAtRef.current + AFTER_NAVIGATION_MS - now
      )
    }

    async function warmRoute(href: string): Promise<boolean> {
      if (!engine.warm(href)) return false
      await waitForRscRequest(href, COMPLETION_TIMEOUT_MS)
      engine.settle(href)
      return true
    }

    function dataIsDue(href: string) {
      if (!hasPageDataWarmer(href)) return false
      const last = dataWarmedAt.get(href)
      return last === undefined || Date.now() - last >= DATA_REWARM_MS
    }

    async function warmData(href: string) {
      dataWarmedAt.set(href, Date.now())
      await warmPageData(href, { userId: forUser })
    }

    async function runTask(task: Task) {
      if (task.kind === "data") {
        if (dataIsDue(task.href)) await warmData(task.href)
        return
      }
      if (task.href === pathnameRef.current || !engine.needsWarm(task.href)) return
      if ((await warmRoute(task.href)) && dataIsDue(task.href)) {
        queue.push({ href: task.href, kind: "data" })
      }
    }

    function schedulePump(delayMs: number) {
      window.clearTimeout(pumpTimer)
      pumpTimer = window.setTimeout(pump, delayMs)
    }

    // Én jobb om gangen, og bare når brukeren er i ro.
    function pump() {
      if (disposed || busy || queue.length === 0) return
      const wait = backgroundWaitMs(Date.now())
      // Skjult fane / spar data / brukt opp budsjett: visibility-lytteren og
      // neste runde av det varme settet tar opp tråden igjen.
      if (wait === null) return
      if (wait > 0 || !engine.isQuiet()) {
        schedulePump(Math.max(wait, 500))
        return
      }
      const task = queue.shift()!
      busy = true
      runTask(task)
        .catch(() => {})
        .finally(() => {
          busy = false
          schedulePump(GAP_MS)
        })
    }

    function enqueue(tasks: Task[], { front = false } = {}) {
      const fresh = tasks.filter(
        (task) => !queue.some((queued) => queued.href === task.href && queued.kind === task.kind)
      )
      if (front) queue.unshift(...fresh)
      else queue.push(...fresh)
      // Også uten nye jobber: køen kan ha stått stille (skjult fane, brukt opp budsjett).
      if (queue.length > 0 && !busy) schedulePump(0)
    }

    // Intensjon: siden brukeren peker på eller trykker på, varmes straks —
    // utenfor køen, så den aldri står bak bakgrunnsarbeid.
    function warmIntent(href: string) {
      if (disposed || href === pathnameRef.current || !isWarmable(href)) return
      if (engine.isInFlight(href) || !engine.needsWarm(href)) return
      void warmRoute(href).then((warmed) => {
        if (warmed && dataIsDue(href)) void warmData(href)
      })
    }

    const onInteraction = () => {
      lastInteractionAt = Date.now()
    }
    const onPress = (event: Event) => {
      onInteraction()
      const href = internalLinkPath(event.target)
      if (href) warmIntent(href)
    }
    const onPointerOver = (event: PointerEvent) => {
      window.clearTimeout(hoverTimer)
      if (event.pointerType !== "mouse") return
      const href = internalLinkPath(event.target)
      if (href) hoverTimer = window.setTimeout(() => warmIntent(href), HOVER_INTENT_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedulePump(0)
    }

    const capture = { passive: true, capture: true } as const
    window.addEventListener("pointerdown", onPress, capture)
    window.addEventListener("keydown", onInteraction, capture)
    window.addEventListener("wheel", onInteraction, capture)
    window.addEventListener("touchmove", onInteraction, capture)
    // Scroll skjer i skallets egen container, ikke på window — fang den i capture.
    document.addEventListener("scroll", onInteraction, capture)
    document.addEventListener("pointerover", onPointerOver, { passive: true })
    document.addEventListener("visibilitychange", onVisibility)

    // Første pass: hele planen (iOS-appen bare det varme settet).
    const initial = currentPlan()
    enqueue((nativeIos ? initial.hot : initial.plan).map((href) => ({ href, kind: "route" as const })))

    // Deretter: forny det varme settet mens brukeren er aktiv — foran i køen.
    const tick = window.setInterval(() => {
      const now = Date.now()
      if (now - Math.max(lastInteractionAt, lastNavigationAtRef.current) > ACTIVE_WINDOW_MS) return
      const due = currentPlan().hot.filter((href) => engine.needsWarm(href) && !engine.isInFlight(href))
      enqueue(
        due.map((href) => ({ href, kind: "route" as const })),
        { front: true }
      )
    }, KEEP_WARM_TICK_MS)

    return () => {
      disposed = true
      window.clearInterval(tick)
      window.clearTimeout(pumpTimer)
      window.clearTimeout(hoverTimer)
      window.removeEventListener("pointerdown", onPress, capture)
      window.removeEventListener("keydown", onInteraction, capture)
      window.removeEventListener("wheel", onInteraction, capture)
      window.removeEventListener("touchmove", onInteraction, capture)
      document.removeEventListener("scroll", onInteraction, capture)
      document.removeEventListener("pointerover", onPointerOver)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [userId, navKey, nativeTabsKey])

  return null
}
