"use client"

import { useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"
import { useEffect, useRef } from "react"

import { useAuth } from "@/components/auth-provider"
import { hasPageDataWarmer, warmPageData } from "@/lib/perf/page-data-warmers"

/**
 * Henter siden brukeren er i ferd med å åpne — og bare den.
 *
 * Når pekeren hviler på en lenke, eller fingeren treffer den, begynner
 * serveren å rendre siden med én gang. Klikket kommer typisk 100–300 ms
 * senere og gjenbruker svaret som allerede er på vei.
 *
 * Erstatter bakgrunnsforvarmingen av HELE menyen (september 2026). Den
 * rendret ~20 sider per sidelasting og mangedoblet databasetrafikken; på
 * Supabase Free/Nano brant det opp CPU-kvoten, gjorde ALLE spørringer trege
 * og tømte til slutt tilkoblingsbassenget. Ikke gjeninnfør forvarming av
 * sider brukeren ikke har vist at hen skal til.
 *
 * Next sin ruter-cache dedupliserer: en side som allerede er hentet og
 * fortsatt fersk, hentes ikke på nytt. Bare i produksjonsbygg (Next gjør ikke
 * prefetch i utvikling).
 */

/**
 * Så lenge pekeren må hvile på en lenke før det regnes som en intensjon.
 * 100 ms var for kort: en mus som sveipes nedover menyen utløste full
 * serverrendring av flere sider etter hverandre.
 */
const HOVER_INTENT_MS = 180

const ENABLED = process.env.NODE_ENV === "production"

/** Sti for en intern app-lenke under et DOM-element — ellers null. */
function internalLinkPath(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest("a[href]")
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) {
    return null
  }
  try {
    const url = new URL(anchor.href)
    if (url.origin !== window.location.origin) return null
    // API-ruter og filer er ikke sider.
    if (url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname)) return null
    return url.pathname + url.search
  } catch {
    return null
  }
}

export function IntentPrefetch() {
  const router = useRouter()
  const { user } = useAuth()
  const userId: string | null = user?.id ?? null

  const routerRef = useRef(router)
  const userIdRef = useRef(userId)
  useEffect(() => {
    routerRef.current = router
    userIdRef.current = userId
  }, [router, userId])

  useEffect(() => {
    if (!ENABLED) return
    let hoverTimer: number | undefined

    const prefetch = (href: string) => {
      if (href === window.location.pathname + window.location.search) return
      routerRef.current.prefetch(href, { kind: PrefetchKind.FULL })
      // Sider som henter dataene sine i nettleseren (kalender, dokumenter,
      // mine priser) får også dataene sine i gang.
      const pathname = href.split("?")[0]
      const forUser = userIdRef.current
      if (forUser && hasPageDataWarmer(pathname)) void warmPageData(pathname, { userId: forUser })
    }

    const onPointerOver = (event: PointerEvent) => {
      window.clearTimeout(hoverTimer)
      if (event.pointerType !== "mouse") return
      const href = internalLinkPath(event.target)
      if (href) hoverTimer = window.setTimeout(() => prefetch(href), HOVER_INTENT_MS)
    }
    const onPointerDown = (event: PointerEvent) => {
      // Berøring/klikk: ingen grunn til å vente — navigasjonen kommer straks.
      const href = internalLinkPath(event.target)
      if (href) prefetch(href)
    }

    document.addEventListener("pointerover", onPointerOver, { passive: true })
    document.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true })
    return () => {
      window.clearTimeout(hoverTimer)
      document.removeEventListener("pointerover", onPointerOver)
      document.removeEventListener("pointerdown", onPointerDown, { capture: true })
    }
  }, [])

  return null
}
