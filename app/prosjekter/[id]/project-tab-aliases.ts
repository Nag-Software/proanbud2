/**
 * Faner som er slått sammen til én, med hvilken underfane den gamle verdien
 * svarer til.
 *
 * Gamle `?tab=`-verdier lever videre i lenker inne i appen (HMS-oversikten,
 * utfylling av sjekkliste, revalidatePath i app/ks/actions.ts) og i URL-er
 * brukerne har delt eller bokmerket. De må fortsatt lande på riktig sted, så
 * aliasene fjernes ikke selv om appen selv lenker til den nye adressen.
 */
export const PROJECT_TAB_ALIASES: Record<string, { tab: string; sub: string }> = {
  ks: { tab: "kvalitet", sub: "sjekklister" },
  avvik: { tab: "kvalitet", sub: "avvik" },
}

/** Oversetter en `?tab=`-verdi til fanen (og evt. underfanen) den hører til i dag. */
export function resolveProjectTabParam(
  tabParam: string | null | undefined
): { tab: string; sub?: string } | null {
  if (!tabParam) return null
  return PROJECT_TAB_ALIASES[tabParam] ?? { tab: tabParam }
}

/** Underfanen en `?tab=`-alias peker på, hvis verdien er en alias. */
export function aliasSubTab(tabParam: string | null | undefined): string | null {
  if (!tabParam) return null
  return PROJECT_TAB_ALIASES[tabParam]?.sub ?? null
}
