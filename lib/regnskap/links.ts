import { createAdminClient } from "@/lib/supabase/admin"
import { getAdapter } from "@/lib/regnskap/registry"
import type {
  AccountingEntityType,
  AccountingLinkView,
  AccountingProviderId,
} from "@/lib/regnskap/types"

type LinkRow = {
  entity_type: string
  local_id: string
  external_id: number | string | null
  external_url: string | null
  sync_status: string | null
  last_synced_at: string | null
}

const LINK_COLUMNS = "entity_type, local_id, external_id, external_url, sync_status, last_synced_at"

/**
 * Leser external_entity_links med KANONISKE entitetsnavn.
 *
 * Fiken lagrer "contact" der Tripletex lagrer "customer" (se adapterens
 * storedEntityTypes). Vi leser alle variantene, slik at ingen kallsteder må vite
 * om forskjellen — og slik at vi slipper en risikabel datamigrering som ville
 * mistet dedupe-nøkkelen midt i drift.
 */
export async function fetchAccountingLinks(input: {
  companyId: string
  provider: AccountingProviderId
  localIds: string[]
}): Promise<LinkRow[]> {
  const localIds = input.localIds.filter(Boolean)
  if (localIds.length === 0) return []

  const admin = createAdminClient()
  const { data } = await admin
    .from("external_entity_links")
    .select(LINK_COLUMNS)
    .eq("company_id", input.companyId)
    .eq("provider", input.provider)
    .in("local_id", localIds)

  return (data || []) as LinkRow[]
}

export function pickLink(
  rows: LinkRow[],
  provider: AccountingProviderId,
  entity: AccountingEntityType,
  localId?: string | null
): AccountingLinkView {
  const names = getAdapter(provider).storedEntityTypes(entity)
  if (names.length === 0) return null

  // Rekkefølgen i storedEntityTypes er prioritert: den kanoniske først.
  for (const name of names) {
    const row = rows.find(
      (candidate) =>
        candidate.entity_type === name && (!localId || candidate.local_id === localId)
    )
    if (row) {
      return {
        entityType: entity,
        externalId: row.external_id,
        externalUrl: row.external_url,
        syncStatus: row.sync_status,
        lastSyncedAt: row.last_synced_at,
      }
    }
  }
  return null
}
