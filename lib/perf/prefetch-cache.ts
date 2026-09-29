/**
 * Liten minnecache for sider som henter dataene sine i nettleseren.
 *
 * Brukes av bakgrunnsforvarmingen (som fyller den før brukeren klikker) og av
 * sidene selv (som viser det som ligger der med en gang og friskt opp i
 * bakgrunnen). Et kall som allerede er i gang deles, så en side som åpnes
 * mens forvarmingen fortsatt henter, venter på det samme svaret i stedet for
 * å sende et nytt.
 *
 * Avgrenset til innlogget bruker: bytter kontoen i fanen, tømmes alt, så én
 * brukers data aldri kan vises for en annen. Ligger bare i minnet — en ny
 * fane eller full innlasting starter tomt.
 */

type Entry = { value: unknown; fetchedAt: number }

const entries = new Map<string, Entry>()
const inFlight = new Map<string, Promise<unknown>>()
let scope: string | null = null
// Økes ved hvert scope-bytte, så svar fra forrige bruker som lander sent
// aldri skrives inn i den nye brukerens cache.
let generation = 0
// Rekkefølgen kallene startet i, per nøkkel — se fetchPrefetched.
let lastSequence = 0
const latestSequence = new Map<string, number>()

/** Sett hvilken bruker cachen tilhører. Et bytte tømmer alt. */
export function setPrefetchCacheScope(userId: string | null) {
  if (userId === scope) return
  scope = userId
  generation++
  entries.clear()
  inFlight.clear()
  latestSequence.clear()
}

export function readPrefetched<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined
}

/** Når verdien sist ble hentet (epoch ms), eller null. */
export function prefetchedAt(key: string): number | null {
  return entries.get(key)?.fetchedAt ?? null
}

export function writePrefetched<T>(key: string, value: T) {
  entries.set(key, { value, fetchedAt: Date.now() })
}

/**
 * Speil en lokal endring (optimistisk oppdatering etter lagring/sletting) inn
 * i cachen uten å late som den er nyhentet — hentetidspunktet beholdes, så
 * neste åpning av siden fortsatt revaliderer når det er på tide. Gjør
 * ingenting før første vellykkede henting (et tomt resultat fra en feilet
 * lasting skal ikke se ut som «ingen data»).
 */
export function replacePrefetched<T>(key: string, value: T) {
  const entry = entries.get(key)
  if (entry) entry.value = value
}

/**
 * Hent via cachen. Returnerer den lagrede verdien uten nettverk hvis den er
 * yngre enn `maxAgeMs`; ellers deles et pågående kall, eller et nytt startes.
 * `force` hopper over både lagret verdi og pågående kall (etter en endring).
 *
 * Svarene kommer ikke nødvendigvis i den rekkefølgen kallene startet. Et kall
 * som er gått forbi av et nyere (typisk: en tvunget henting etter en lagring
 * mens åpnings-hentingen fortsatt pågikk) skriver ikke til cachen, og gir
 * kalleren det nyeste svaret i stedet for sitt eget — ellers kunne en ny
 * avtale eller jobb forsvinne igjen fordi et gammelt svar landet sist.
 */
export async function fetchPrefetched<T>(
  key: string,
  fetcher: () => Promise<T>,
  { maxAgeMs = 0, force = false }: { maxAgeMs?: number; force?: boolean } = {}
): Promise<T> {
  if (!force) {
    const entry = entries.get(key)
    if (entry && Date.now() - entry.fetchedAt < maxAgeMs) return entry.value as T
    const pending = inFlight.get(key)
    if (pending) return pending as Promise<T>
  }
  const startedIn = generation
  const sequence = ++lastSequence
  latestSequence.set(key, sequence)
  const promise: Promise<T> = fetcher().then((value) => {
    if (startedIn !== generation) return value
    if (latestSequence.get(key) === sequence) {
      writePrefetched(key, value)
      return value
    }
    const newer = inFlight.get(key)
    if (newer && newer !== promise) return newer as Promise<T>
    return (entries.get(key)?.value as T | undefined) ?? value
  })
  inFlight.set(key, promise)
  const clear = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key)
  }
  promise.then(clear, clear)
  return promise
}
