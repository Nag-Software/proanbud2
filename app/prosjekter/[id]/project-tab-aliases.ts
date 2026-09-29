/**
 * Prosjektsiden har én rad faner (se docs/prosjektside-mockups, forslag A):
 *
 *   Oversikt · Økonomi · Oppgaver · Timer og kjøring · KS og avvik · Filer
 *
 * Håndverkeren starter på «I dag» i stedet for Oversikt og ser ikke Økonomi.
 * Fanen ligger i `?tab=`, og et eventuelt sted inne i fanen i `?del=`
 * (en seksjon på Økonomi, et filter på KS og avvik eller Timer og kjøring,
 * 3D-modellen under Filer).
 *
 * Denne fila er det ENESTE stedet gamle adresser oversettes. Siden har hatt
 * tre oppsett: elleve faner på rad, så tre grupper med underfaner
 * (`?tab=arbeid&sub=oppgaver`, `?tab=kvalitet&sub=avvik`, `&ks=avvik`), og nå
 * flate faner. Alle tre formene finnes i delte lenker, bokmerker og e-poster,
 * og må fortsatt lande på riktig sted. INGEN oppføring under fjernes.
 */
export type ResolvedProjectTab = {
  /** Fanen i `?tab=`. */
  tab: string
  /** Stedet inne i fanen, i `?del=`. */
  del?: string
}

/** Fanene som finnes i dag. */
export const PROJECT_TABS = [
  "oversikt",
  "idag",
  "okonomi",
  "oppgaver",
  "timer",
  "kvalitet",
  "filer",
] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

/** Filtrene inne i KS og avvik. Også gamle `?sub=`/`?ks=`-verdier. */
export const KVALITET_LEAVES = ["sjekklister", "avvik"] as const

/** `?del=personer` åpner personpanelet i prosjekttoppen, uansett fane. */
export const PEOPLE_DEL = "personer"

export const PROJECT_TAB_ALIASES: Record<string, ResolvedProjectTab> = {
  // Dagens faner
  oversikt: { tab: "oversikt" },
  idag: { tab: "idag" },
  okonomi: { tab: "okonomi" },
  oppgaver: { tab: "oppgaver" },
  timer: { tab: "timer" },
  kvalitet: { tab: "kvalitet" },
  filer: { tab: "filer" },

  // Gruppene fra oppsett nummer to. Arbeid åpnet den første underfanen.
  arbeid: { tab: "oppgaver" },

  // Underfaner som nå er seksjoner på Økonomi
  tilbud: { tab: "okonomi", del: "tilbud" },
  etterfakturering: { tab: "okonomi", del: "tilleggsarbeid" },
  tilleggsarbeid: { tab: "okonomi", del: "tilleggsarbeid" },
  fakturering: { tab: "okonomi", del: "fakturering" },
  lonnsomhet: { tab: "okonomi", del: "kostnader" },

  // Timeføring og Kjørebok er én logg
  timeforing: { tab: "timer", del: "timer" },
  kjorebok: { tab: "timer", del: "kjoring" },

  // 3D-modellen ligger festet øverst i Filer
  modell: { tab: "filer", del: "modell" },

  // Deltakere er et panel i prosjekttoppen
  deltakere: { tab: "oversikt", del: PEOPLE_DEL },

  // KS og Avvik var egne faner før de ble slått sammen
  ks: { tab: "kvalitet", del: "sjekklister" },
  avvik: { tab: "kvalitet", del: "avvik" },
}

/** Gruppene som hadde underfaner i `?sub=`. */
const LEGACY_GROUPS = new Set(["arbeid", "okonomi"])

const isKvalitetLeaf = (value: string | null | undefined): value is string =>
  !!value && (KVALITET_LEAVES as readonly string[]).includes(value)

/**
 * Oversetter en `?tab=`-verdi (ny eller gammel) til fanen og stedet inne i
 * den. De tre andre parameterne dekker eldre former:
 *
 * - `sub`: `?tab=arbeid&sub=timeforing` (gruppe + underfane) og
 *   `?tab=kvalitet&sub=avvik` (der `sub` var filteret i KS og avvik).
 * - `ks`: `?tab=arbeid&sub=kvalitet&ks=avvik`.
 * - `del`: dagens form. Den vinner over alt annet.
 */
export function resolveProjectTabParam(
  tabParam: string | null | undefined,
  subParam?: string | null,
  ksParam?: string | null,
  delParam?: string | null
): ResolvedProjectTab | null {
  if (!tabParam) return null

  let base: ResolvedProjectTab = PROJECT_TAB_ALIASES[tabParam]
    ? { ...PROJECT_TAB_ALIASES[tabParam] }
    : { tab: tabParam }

  if (subParam) {
    const subAlias = PROJECT_TAB_ALIASES[subParam]
    if (LEGACY_GROUPS.has(tabParam) && subAlias) {
      base = { ...subAlias }
    } else if (base.tab === "kvalitet" && isKvalitetLeaf(subParam)) {
      base.del = subParam
    }
  }

  if (base.tab === "kvalitet" && isKvalitetLeaf(ksParam)) {
    base.del = ksParam
  }

  if (delParam) base.del = delParam

  return base
}

/** Lenke til et sted på prosjektsiden i dagens form. */
export function projectTabHref(projectId: string, tab: ProjectTab, del?: string) {
  const params = new URLSearchParams()
  if (tab !== "oversikt") params.set("tab", tab)
  if (del) params.set("del", del)
  const query = params.toString()
  return query ? `/prosjekter/${projectId}?${query}` : `/prosjekter/${projectId}`
}
