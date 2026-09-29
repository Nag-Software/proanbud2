import { APP_NAV_ENTRIES, filterAppNav, type AppNavContext } from "@/lib/app-nav"

/**
 * Hvilke sider bakgrunnsforvarmingen henter, og i hvilken rekkefølge.
 *
 * Ren logikk uten nettleser-API-er, så den kan testes isolert. Selve
 * hentingen (router.prefetch) bor i components/perf/route-warmer.tsx.
 *
 * Kilden er den samme rolle- og planbevisste lista som søket og mobilmenyen
 * bruker (lib/app-nav), så vi aldri forvarmer en side brukeren ikke har
 * tilgang til — serveren ville uansett svart med redirect, men det er en
 * bortkastet serverless-kjøring.
 */

/** Daglige destinasjoner — forvarmes først og holdes varme mens brukeren jobber. */
export const PRIMARY_HREFS = ["/", "/prosjekter", "/tilbud", "/timeforing", "/kunder"] as const
export const WORKER_PRIMARY_HREFS = ["/timeforing", "/prosjekter", "/kart", "/kjorebok", "/kalender"] as const

/** Så mange prosjektsider (nyligst oppdaterte aktive) forvarmes. */
export const MAX_WARM_PROJECTS = 3

/** Størrelsen på settet som holdes varmt kontinuerlig (resten varmes én gang per økt). */
export const HOT_SET_SIZE = 6

const PROJECT_PATH = /^\/prosjekter\/[0-9a-f-]{36}$/i

const NAV_HREFS = new Set(APP_NAV_ENTRIES.filter((entry) => !entry.menuHidden).map((entry) => entry.href))

/** Besøkshistorikk per sti: antall besøk og sist besøkt (epoch ms). */
export type NavUsage = Record<string, { n: number; t: number }>

const MAX_USAGE_KEYS = 40
const USAGE_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Sti → nøkkel i besøkshistorikken, eller null hvis stien ikke er en side vi
 * forvarmer. Prosjektsider telles per prosjekt; alt annet må være et
 * menypunkt (undersider som /tilbud/[id] telles ikke).
 */
export function usageKeyForPath(pathname: string): string | null {
  if (NAV_HREFS.has(pathname)) return pathname
  if (PROJECT_PATH.test(pathname)) return pathname.toLowerCase()
  return null
}

/** Registrerer et besøk. Returnerer et nytt objekt; beskjærer til de nyeste nøklene. */
export function recordVisit(usage: NavUsage, pathname: string, now: number): NavUsage {
  const key = usageKeyForPath(pathname)
  if (!key) return usage
  const previous = usage[key]
  const next: NavUsage = { ...usage, [key]: { n: (previous?.n ?? 0) + 1, t: now } }
  const keys = Object.keys(next)
  if (keys.length <= MAX_USAGE_KEYS) return next
  const kept = keys.sort((a, b) => next[b].t - next[a].t).slice(0, MAX_USAGE_KEYS)
  return Object.fromEntries(kept.map((k) => [k, next[k]]))
}

/** Besøksvekt med halveringstid, så gamle vaner teller mindre enn dagens. */
export function usageScore(entry: { n: number; t: number } | undefined, now: number): number {
  if (!entry) return 0
  const age = Math.max(0, now - entry.t)
  return entry.n * Math.pow(0.5, age / USAGE_HALF_LIFE_MS)
}

/** Tolerant parsing av lagret historikk (localStorage kan inneholde hva som helst). */
export function parseNavUsage(raw: string | null): NavUsage {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const result: NavUsage = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue
      const { n, t } = value as { n?: unknown; t?: unknown }
      if (typeof n === "number" && typeof t === "number" && Number.isFinite(n) && Number.isFinite(t)) {
        result[key] = { n, t }
      }
    }
    return result
  } catch {
    return {}
  }
}

export type WarmPlanInput = {
  nav: AppNavContext
  currentPath: string
  usage: NavUsage
  /** Aktive prosjekter, nyligst oppdatert først (fra sidebarens prosjektliste). */
  projectHrefs: string[]
  now: number
}

/**
 * Prioritert liste over sider å forvarme:
 * 1. dagens hovedpunkter for rollen,
 * 2. det brukeren faktisk pleier å åpne (besøkshistorikk),
 * 3. resten av menyen i menyrekkefølge,
 * 4. de nyeste aktive prosjektene.
 * Siden brukeren står på tas ut — den er allerede lastet.
 */
export function buildWarmPlan({ nav, currentPath, usage, projectHrefs, now }: WarmPlanInput): string[] {
  const allowed = filterAppNav(nav)
    .filter((entry) => !entry.menuHidden)
    .map((entry) => entry.href)
  const allowedSet = new Set(allowed)
  const primary = (nav.isWorker ? WORKER_PRIMARY_HREFS : PRIMARY_HREFS).filter((href) => allowedSet.has(href))

  const projects = projectHrefs
    .filter((href) => PROJECT_PATH.test(href))
    .slice(0, MAX_WARM_PROJECTS)
    .map((href) => href.toLowerCase())

  const byUsage = [...allowed, ...projects]
    .map((href) => ({ href, score: usageScore(usage[href], now) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.href)

  const ordered = [...primary, ...byUsage, ...allowed, ...projects]
  const seen = new Set<string>([currentPath])
  const plan: string[] = []
  for (const href of ordered) {
    if (seen.has(href)) continue
    seen.add(href)
    plan.push(href)
  }
  return plan
}

/**
 * Settet som holdes varmt mens brukeren er aktiv: hovedpunktene først, deretter
 * de mest brukte sidene. Resten av planen varmes én gang per økt.
 */
export function selectHotSet(plan: string[], nav: AppNavContext, usage: NavUsage, now: number): string[] {
  const primary = new Set<string>(nav.isWorker ? WORKER_PRIMARY_HREFS : PRIMARY_HREFS)
  return plan
    .map((href, index) => ({
      href,
      // Hovedpunkter slår alltid historikk; innen hver gruppe vinner planrekkefølgen.
      rank: (primary.has(href) ? 1_000_000 : 0) + usageScore(usage[href], now) * 1000 - index,
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, HOT_SET_SIZE)
    .map((item) => item.href)
}
