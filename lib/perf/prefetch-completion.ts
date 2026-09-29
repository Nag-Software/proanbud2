/**
 * Vent til nettleseren er ferdig med RSC-forespørselen for en sti.
 *
 * `router.prefetch()` returnerer ingenting, så vi ser ikke selv når en
 * forvarming er ferdig. Nettleseren gjør det: hver fullførte fetch havner i
 * Resource Timing (når hele svaret er mottatt), og Next sine RSC-forespørsler
 * kjennes på `_rsc`-parameteren. Det lar forvarmingen gå strengt én og én, så
 * et klikk aldri står bak en kø av bakgrunnskall.
 *
 * Løses alltid — ved treff, eller etter `timeoutMs` (prefetchen var en no-op
 * fordi Next allerede hadde siden, nettleseren mangler API-et, e.l.).
 */

type Waiter = { pathname: string; since: number; done: () => void }

const waiters = new Set<Waiter>()
let observer: PerformanceObserver | null = null
let unsupported = false

function ensureObserver(): boolean {
  if (observer) return true
  if (unsupported || typeof PerformanceObserver === "undefined") {
    unsupported = true
    return false
  }
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming
        if (resource.initiatorType !== "fetch") continue
        let url: URL
        try {
          url = new URL(resource.name)
        } catch {
          continue
        }
        if (!url.searchParams.has("_rsc")) continue
        for (const waiter of waiters) {
          // Bare forespørsler som startet etter at vi begynte å vente.
          if (waiter.pathname === url.pathname && resource.startTime >= waiter.since - 50) {
            waiter.done()
          }
        }
      }
    })
    observer.observe({ type: "resource", buffered: false })
    return true
  } catch {
    unsupported = true
    observer = null
    return false
  }
}

/** Uten Resource Timing: anta at en forvarming tar omtrent så lang tid. */
const FALLBACK_WAIT_MS = 1_200

export function waitForRscRequest(pathname: string, timeoutMs: number): Promise<void> {
  const observing = ensureObserver()
  return new Promise((resolve) => {
    const waiter: Waiter = {
      pathname,
      since: performance.now(),
      done: () => {
        if (!waiters.delete(waiter)) return
        clearTimeout(timer)
        resolve()
      },
    }
    waiters.add(waiter)
    // Observatøren melder alltid asynkront, så `timer` er satt før done() kan kalles.
    const timer = setTimeout(waiter.done, observing ? timeoutMs : FALLBACK_WAIT_MS)
  })
}
