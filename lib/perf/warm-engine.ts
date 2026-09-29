/**
 * Bokføring for bakgrunnsforvarmingen: hvilke sider som er varme, når de
 * kjøles ned, og hvor mye vi har lov til å bruke.
 *
 * Next sin ruter-cache er fasiten for selve dataene; denne motoren holder bare
 * styr på det Next ikke eksponerer — når en forvarming faktisk ble ferdig, når
 * den utløper, og om Next siden har kastet cachen (onInvalidate).
 *
 * Ingen nettleser-API-er her; `prefetch` og `now` injiseres, så motoren kan
 * testes med falsk klokke.
 */

/**
 * Levetiden til en full prefetch i Next sin ruter-cache. MÅ følge
 * `experimental.staleTimes.static` i next.config.ts — det er den verdien Next
 * bruker for `router.prefetch(…, { kind: FULL })`.
 */
export const WARM_TTL_MS = 60_000

/**
 * Varm på nytt først når Next garantert har latt oppføringen gå ut. En
 * prefetch av en oppføring som fortsatt er gyldig er en no-op i Next — den
 * ville kostet budsjett uten å hente noe, og siden ville blitt kald like etter.
 */
export const EXPIRY_MARGIN_MS = 1_500

/** En forvarming som ikke har meldt seg ferdig etter dette regnes som tapt. */
export const IN_FLIGHT_TIMEOUT_MS = 15_000

/**
 * Tak på antall forvarminger per fane i et glidende vindu. Hvert kall er en
 * serverless-kjøring på Vercel (Hobby-planen har ingen overforbruk — den
 * stopper), så dette er en sikring mot løpske løkker, ikke et mål. Et fullt
 * pass for en admin er ~20 sider, og det varme settet (5 sider) fornyes hvert
 * minutt mens brukeren er aktiv.
 */
export const WARM_BUDGET = { max: 80, windowMs: 10 * 60_000 }

/** Stilleperiode etter at Next kastet cachen: 5 s, doblet for hver ny tømming tett på, maks 60 s. */
const QUIET_BASE_MS = 5_000
const QUIET_MAX_MS = 60_000
const QUIET_STREAK_WINDOW_MS = 2 * 60_000

type Entry = {
  requestedAt: number
  /** Når svaret var ferdig; null mens forespørselen pågår. */
  settledAt: number | null
  invalidated: boolean
}

export type WarmEngineOptions = {
  prefetch: (href: string, onInvalidate: () => void) => void
  now?: () => number
  ttlMs?: number
  budget?: { max: number; windowMs: number }
  /** Kalles når Next har kastet cachen for en side vi har varmet. */
  onInvalidate?: (href: string) => void
}

export type WarmEngine = ReturnType<typeof createWarmEngine>

export function createWarmEngine({
  prefetch,
  now = () => Date.now(),
  ttlMs = WARM_TTL_MS,
  budget = WARM_BUDGET,
  onInvalidate,
}: WarmEngineOptions) {
  const entries = new Map<string, Entry>()
  const spent: number[] = []
  // Tidspunktene for cache-tømminger (én per hendelse — Next varsler alle
  // forvarmede sider samtidig når den kaster cachen).
  const invalidations: number[] = []

  function pruneBudget(at: number) {
    while (spent.length > 0 && at - spent[0] >= budget.windowMs) spent.shift()
  }

  function isInFlight(href: string, at = now()): boolean {
    const entry = entries.get(href)
    return !!entry && entry.settledAt === null && at - entry.requestedAt < IN_FLIGHT_TIMEOUT_MS
  }

  /** Trenger siden varming nå? (aldri varmet, kastet av Next, eller utløpt) */
  function needsWarm(href: string, at = now()): boolean {
    const entry = entries.get(href)
    if (!entry || entry.invalidated) return true
    if (entry.settledAt === null) return at - entry.requestedAt >= IN_FLIGHT_TIMEOUT_MS
    return at >= entry.settledAt + ttlMs + EXPIRY_MARGIN_MS
  }

  function hasBudget(at = now()): boolean {
    pruneBudget(at)
    return spent.length < budget.max
  }

  /**
   * Varm én side hvis den trenger det og budsjettet tillater det.
   * Returnerer true hvis en forespørsel faktisk ble sendt; kalleren melder
   * fra med `settle` når svaret er ferdig.
   */
  function warm(href: string): boolean {
    const at = now()
    if (!needsWarm(href, at) || !hasBudget(at)) return false
    const entry: Entry = { requestedAt: at, settledAt: null, invalidated: false }
    entries.set(href, entry)
    spent.push(at)
    prefetch(href, () => {
      // En eldre prefetch kan melde fra etter at vi har varmet på nytt — bare
      // den gjeldende oppføringen skal merkes.
      if (entries.get(href) !== entry) return
      entry.invalidated = true
      const when = now()
      if (invalidations.length === 0 || when - invalidations[invalidations.length - 1] > 1_000) {
        invalidations.push(when)
      }
      onInvalidate?.(href)
    })
    return true
  }

  /** Forvarmingen av `href` er ferdig (svaret ligger i Next sin cache). */
  function settle(href: string, at = now()) {
    const entry = entries.get(href)
    if (entry && entry.settledAt === null) entry.settledAt = at
  }

  /**
   * Brukeren navigerte nettopp hit: Next har ferske data for siden (og bruker
   * dem til en full prefetch i samme levetid), så en forvarming nå ville vært
   * en no-op. Regn den som varm fra nå av.
   */
  function markFresh(href: string, at = now()) {
    entries.set(href, { requestedAt: at, settledAt: at, invalidated: false })
  }

  /**
   * Har det vært stille lenge nok siden Next sist kastet cachen? En serie
   * endringer (hver lagring kaster hele ruter-cachen) skal ikke gi en ny
   * oppvarming per lagring: ventetiden dobles for hver tømming tett på
   * forrige, opp til ett minutt.
   */
  function isQuiet(at = now()): boolean {
    while (invalidations.length > 0 && at - invalidations[0] > QUIET_STREAK_WINDOW_MS) invalidations.shift()
    if (invalidations.length === 0) return true
    const quietFor = Math.min(QUIET_MAX_MS, QUIET_BASE_MS * 2 ** (invalidations.length - 1))
    return at - invalidations[invalidations.length - 1] >= quietFor
  }

  return { warm, settle, markFresh, needsWarm, isInFlight, hasBudget, isQuiet }
}
