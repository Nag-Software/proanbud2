/**
 * Fanene på prosjektsiden er gruppert i tre: Oversikt, Arbeid og Økonomi.
 * Sidene ligger som underfaner i `?sub=`, gruppa i `?tab=`.
 *
 * Denne fila er det ENESTE stedet gamle adresser oversettes. Alle gamle
 * `?tab=`-verdier lever videre i lenker inne i appen (HMS-oversikten,
 * utfylling av sjekkliste, revalidatePath i app/ks/actions.ts), i
 * navigateToTab()-kall fra Oversikt, og i URL-er brukerne har delt eller
 * bokmerket. De må fortsatt lande på riktig sted, så INGEN oppføring under
 * fjernes — heller ikke når en fane bytter gruppe.
 */
export type ResolvedProjectTab = {
  /** Gruppa i `?tab=`. */
  tab: string
  /** Siden inne i gruppa, i `?sub=`. */
  sub?: string
  /** Bladnivået inne i KS & Avvik, i `?ks=`. */
  ks?: string
}

/** Underfanene inne i KS & Avvik-panelet. De ligger ett nivå under `?sub=`. */
export const KVALITET_LEAVES = ["sjekklister", "avvik"] as const

export const PROJECT_TAB_ALIASES: Record<string, ResolvedProjectTab> = {
  // Oversikt er sin egen gruppe uten underfaner.
  oversikt: { tab: "oversikt" },

  // Arbeid
  oppgaver: { tab: "arbeid", sub: "oppgaver" },
  timeforing: { tab: "arbeid", sub: "timeforing" },
  filer: { tab: "arbeid", sub: "filer" },
  modell: { tab: "arbeid", sub: "modell" },
  deltakere: { tab: "arbeid", sub: "deltakere" },
  kvalitet: { tab: "arbeid", sub: "kvalitet" },
  // Fra da KS og Avvik var to separate faner (se project-prosjekt-fane-
  // sammenslaing): begge lander i KS & Avvik, på hver sin underfane.
  ks: { tab: "arbeid", sub: "kvalitet", ks: "sjekklister" },
  avvik: { tab: "arbeid", sub: "kvalitet", ks: "avvik" },

  // Økonomi
  tilbud: { tab: "okonomi", sub: "tilbud" },
  etterfakturering: { tab: "okonomi", sub: "etterfakturering" },
  lonnsomhet: { tab: "okonomi", sub: "lonnsomhet" },
  kjorebok: { tab: "okonomi", sub: "kjorebok" },
}

/**
 * Oversetter en `?tab=`-verdi (ny eller gammel) til gruppa, underfanen og
 * eventuelt bladnivået den hører til i dag.
 *
 * `subParam` tas med fordi lenker fra mellomperioden ser slik ut:
 * `?tab=kvalitet&sub=avvik`. Da betydde `sub` bladnivået inne i Kvalitet; nå
 * betyr `sub` siden inne i gruppa. Er den innkommende `sub`-verdien et
 * KS-blad, tolkes den som `ks` slik den var ment.
 */
export function resolveProjectTabParam(
  tabParam: string | null | undefined,
  subParam?: string | null
): ResolvedProjectTab | null {
  if (!tabParam) return null

  const alias = PROJECT_TAB_ALIASES[tabParam]
  const base: ResolvedProjectTab = alias ? { ...alias } : { tab: tabParam }

  if (subParam) {
    if ((KVALITET_LEAVES as readonly string[]).includes(subParam) && base.sub === "kvalitet") {
      // Gammel form: ?tab=kvalitet&sub=avvik
      base.ks = base.ks ?? subParam
    } else if (!alias) {
      // Ny form: ?tab=<gruppe>&sub=<side>
      base.sub = subParam
    }
  }

  return base
}

/** Bladfanen en `?tab=`-alias peker på, hvis verdien er en alias. */
export function aliasSubTab(tabParam: string | null | undefined): string | null {
  if (!tabParam) return null
  return PROJECT_TAB_ALIASES[tabParam]?.ks ?? null
}
