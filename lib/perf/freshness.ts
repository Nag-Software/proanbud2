/**
 * Ferskhet for serverrendrede sider.
 *
 * Bakgrunnsforvarmingen gjør at en side kan vises fra Next sin ruter-cache
 * med data som er opptil fem minutter gamle. Det er prisen for at første klikk
 * er øyeblikkelig. For at det ikke skal bli en pris brukeren merker, stempler
 * serveren hver side med når den ble rendret (se AppPageShell), og skallet
 * friskes stille opp i bakgrunnen hvis det brukeren ser er eldre enn
 * sidens ferskhetsvindu — stale-while-revalidate på sidenivå.
 *
 * Tidsstempelet kommer fra serverens klokke, men alderen må regnes ut på
 * klienten, hvis klokke kan gå minutter feil. Vi sammenligner derfor aldri
 * direkte, men måler avviket: for hver side som registreres er
 * `klientNå - rendretAv` lik klokkeavvik + sidens alder. Minimum over alle
 * observasjoner er det beste estimatet på avviket alene (den ferskeste siden
 * vi har sett), og alderen er differansen mot det. Det tåler et hvilket som
 * helst konstant klokkeavvik; i verste fall overvurderes alderen med
 * forsinkelsen på den ferskeste siden, som er godt innenfor vinduet.
 */

/** Standard ferskhetsvindu — samme som `staleTimes.dynamic` i next.config.ts. */
export const DEFAULT_FRESH_FOR_MS = 30_000

/**
 * Tidsstempel for når serveren rendret siden. Egen funksjon (ikke Date.now()
 * rett i komponenten) fordi det er et bevisst urent kall: verdien SKAL være
 * forskjellig fra render til render.
 */
export function renderTimestamp(): number {
  return Date.now()
}

export type PageStamp = {
  pathname: string
  renderedAt: number
  freshForMs: number
}

export function createFreshnessTracker() {
  let minOffset: number | null = null

  return {
    /** Registrer at en side med dette stempelet ble vist ved `clientNow`. */
    observe(renderedAt: number, clientNow: number) {
      const offset = clientNow - renderedAt
      if (minOffset === null || offset < minOffset) minOffset = offset
    },
    /** Estimert alder på dataene i en side, korrigert for klokkeavvik. */
    ageOf(renderedAt: number, clientNow: number): number {
      const offset = clientNow - renderedAt
      return Math.max(0, offset - (minOffset ?? offset))
    },
  }
}

export type FreshnessTracker = ReturnType<typeof createFreshnessTracker>

/**
 * Skal siden friskes opp nå? Bare hvis stempelet tilhører siden brukeren står
 * på (et skjelett eller forrige side teller ikke) og dataene er eldre enn
 * vinduet.
 */
export function isStale(stamp: PageStamp | null, pathname: string, ageMs: number): boolean {
  if (!stamp || stamp.pathname !== pathname) return false
  return ageMs > stamp.freshForMs
}
