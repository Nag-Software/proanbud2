import { fikenAdapter } from "@/lib/integrations/fiken/adapter"
import { tripletexAdapter } from "@/lib/integrations/tripletex/adapter"
import type { AccountingAdapter } from "@/lib/regnskap/provider"
import type { AccountingConnectionState, AccountingProviderId } from "@/lib/regnskap/types"

export const ADAPTERS: Record<AccountingProviderId, AccountingAdapter> = {
  fiken: fikenAdapter,
  tripletex: tripletexAdapter,
}

export function getAdapter(provider: AccountingProviderId): AccountingAdapter {
  return ADAPTERS[provider]
}

export type ActiveAccountingProvider = {
  adapter: AccountingAdapter
  state: AccountingConnectionState
}

/**
 * Hvilken regnskapsintegrasjon er aktiv for denne bedriften?
 *
 * Kun én om gangen — det er håndhevet ved tilkobling. Rekkefølgen under er en
 * sikkerhetsventil for gamle rader der begge rakk å bli koblet til før vakten
 * fantes på Tripletex-siden; Fiken vinner, som før.
 *
 * Returnerer også tilkoblinger som ikke er klare ennå (Fiken uten valgt firma),
 * slik at UI kan si «fullfør oppsettet» i stedet for å påstå at ingenting finnes.
 */
export async function getActiveAccountingProvider(
  companyId: string
): Promise<ActiveAccountingProvider | null> {
  const [fiken, tripletex] = await Promise.all([
    fikenAdapter.getConnectionState(companyId),
    tripletexAdapter.getConnectionState(companyId),
  ])

  if (fiken) return { adapter: fikenAdapter, state: fiken }
  if (tripletex) return { adapter: tripletexAdapter, state: tripletex }
  return null
}

/** Som over, men kun når integrasjonen faktisk kan synke. */
export async function getReadyAccountingProvider(
  companyId: string
): Promise<ActiveAccountingProvider | null> {
  const active = await getActiveAccountingProvider(companyId)
  return active?.state.ready ? active : null
}

/**
 * Er en ANNEN leverandør allerede koblet til? Brukes til å håndheve
 * «ett regnskapssystem om gangen» ved tilkobling — i begge retninger.
 */
export async function findConflictingProvider(
  companyId: string,
  connecting: AccountingProviderId
): Promise<AccountingProviderId | null> {
  const others = (Object.keys(ADAPTERS) as AccountingProviderId[]).filter((id) => id !== connecting)
  for (const id of others) {
    const state = await ADAPTERS[id].getConnectionState(companyId)
    if (state) return id
  }
  return null
}
