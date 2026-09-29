/**
 * Bokføring for bakgrunnsforvarmingen: hvilke sider som er varme, når de
 * kjøles ned, og hvor mye vi har lov til å bruke.
 *
 * Next sin ruter-cache er fasiten for selve dataene; denne motoren holder bare
 * styr på det Next ikke eksponerer — når VI sist varmet en side, og om Next
 * siden har kastet cachen (onInvalidate). Uten dette ville hvert nytt
 * forvarmingspass telle sider som allerede ligger klare, og budsjettet ville
 * være meningsløst.
 *
 * Ingen nettleser-API-er her; `prefetch` og `now` injiseres, så motoren kan
 * testes med falsk klokke.
 */

/**
 * Levetiden til en full prefetch i Next sin ruter-cache. MÅ følge
 * `experimental.staleTimes.static` i next.config.ts (300 s) — det er den
 * verdien Next bruker for `router.prefetch(…, { kind: FULL })`.
 */
export const WARM_TTL_MS = 300_000

/** Varm på nytt litt før Next kaster oppføringen, så det aldri oppstår et kaldt hull. */
export const REWARM_MARGIN_MS = 20_000

/**
 * Tak på antall forvarminger per fane i et glidende vindu. Hvert kall er en
 * serverless-kjøring på Vercel (Hobby-planen har ingen overforbruk — den
 * stopper), så dette er en sikring mot løpske løkker, ikke et mål.
 * Et fullt pass for en admin er ~20 sider; vinduet gir rom for ett fullt pass
 * pluss jevnlig oppvarming av hovedsettet.
 */
export const WARM_BUDGET = { max: 48, windowMs: 10 * 60_000 }

type Entry = {
  warmedAt: number
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
  let lastInvalidationAt = Number.NEGATIVE_INFINITY

  function pruneBudget(at: number) {
    while (spent.length > 0 && at - spent[0] >= budget.windowMs) spent.shift()
  }

  /** Trenger siden varming nå? (aldri varmet, kastet av Next, eller snart utløpt) */
  function needsWarm(href: string, at = now()): boolean {
    const entry = entries.get(href)
    if (!entry || entry.invalidated) return true
    return at >= entry.warmedAt + ttlMs - REWARM_MARGIN_MS
  }

  function hasBudget(at = now()): boolean {
    pruneBudget(at)
    return spent.length < budget.max
  }

  /**
   * Varm én side hvis den trenger det og budsjettet tillater det.
   * Returnerer true hvis en forespørsel faktisk ble sendt.
   */
  function warm(href: string): boolean {
    const at = now()
    if (!needsWarm(href, at) || !hasBudget(at)) return false
    const entry: Entry = { warmedAt: at, invalidated: false }
    entries.set(href, entry)
    spent.push(at)
    prefetch(href, () => {
      // En eldre prefetch kan melde fra etter at vi har varmet på nytt — bare
      // den gjeldende oppføringen skal merkes.
      if (entries.get(href) !== entry) return
      entry.invalidated = true
      lastInvalidationAt = now()
      onInvalidate?.(href)
    })
    return true
  }

  /**
   * Millisekunder siden Next sist kastet en side vi har varmet. En serie
   * endringer (hver lagring kaster hele ruter-cachen) skal ikke gi en ny
   * oppvarming per lagring — vi venter til det har vært stille en stund.
   */
  function msSinceInvalidation(at = now()): number {
    return at - lastInvalidationAt
  }

  return { warm, needsWarm, hasBudget, msSinceInvalidation }
}
