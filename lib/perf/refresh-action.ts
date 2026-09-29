"use server"

import { refresh } from "next/cache"

/**
 * Rendrer siden brukeren står på på nytt, i samme rundtur som kallet.
 *
 * Hvorfor en server action og ikke `router.refresh()`: router.refresh() kaster
 * HELE ruter-cachen (alle forvarmede sider), mens `refresh()` fra next/cache
 * bare markerer dynamiske data som utdatert for den gjeldende siden
 * (ActionDidRevalidateDynamicOnly) — de forvarmede sidene overlever.
 *
 * Ingen autorisasjon trengs her: kallet gjør ingenting annet enn det en vanlig
 * sidevisning gjør, og selve renderingen går gjennom middleware og sidens egne
 * tilgangssjekker som alltid.
 */
export async function refreshCurrentPageAction(): Promise<void> {
  refresh()
}
