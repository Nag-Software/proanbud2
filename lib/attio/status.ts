// Hvordan står det til med Attio-synken? Til panelet i /selger/innstillinger.
// Leser bare vår egen database — ingen kall mot Attio når siden lastes.

import { createAdminClient } from "@/lib/supabase/admin"
import { getAttioApiKey } from "@/lib/attio/client"
import { isAttioEnabled } from "@/lib/attio/sync"

export type AttioStatus = {
  /** ATTIO_SYNC=on og ATTIO_API_KEY finnes. */
  enabled: boolean
  hasKey: boolean
  setupAt: string | null
  webhook: boolean
  inAttio: number
  queued: number
  failing: number
  lastSyncedAt: string | null
  errors: Array<{ prospectId: string; name: string; error: string }>
}

export async function fetchAttioStatus(): Promise<AttioStatus> {
  const empty: AttioStatus = {
    enabled: isAttioEnabled(),
    hasKey: Boolean(getAttioApiKey()),
    setupAt: null,
    webhook: false,
    inAttio: 0,
    queued: 0,
    failing: 0,
    lastSyncedAt: null,
    errors: [],
  }

  try {
    const admin = createAdminClient()
    const [settings, inAttio, queued, failing, last, errors] = await Promise.all([
      admin
        .from("selger_settings")
        .select("attio_setup_at, attio_webhook_id")
        .eq("id", "global")
        .maybeSingle<{ attio_setup_at: string | null; attio_webhook_id: string | null }>(),
      admin.from("prospects").select("id", { count: "exact", head: true }).not("attio_deal_id", "is", null),
      admin.from("attio_outbox").select("prospect_id", { count: "exact", head: true }),
      admin.from("attio_outbox").select("prospect_id", { count: "exact", head: true }).not("last_error", "is", null),
      admin
        .from("prospects")
        .select("attio_synced_at")
        .not("attio_synced_at", "is", null)
        .order("attio_synced_at", { ascending: false })
        .limit(1),
      admin
        .from("prospects")
        .select("id, name, attio_error")
        .not("attio_error", "is", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ])

    // Mangler kolonnene (db/104 ikke kjørt), er alt bare tomt.
    if (settings.error) return empty

    return {
      ...empty,
      setupAt: settings.data?.attio_setup_at ?? null,
      webhook: Boolean(settings.data?.attio_webhook_id),
      inAttio: inAttio.count ?? 0,
      queued: queued.count ?? 0,
      failing: failing.count ?? 0,
      lastSyncedAt: ((last.data ?? [])[0] as { attio_synced_at: string } | undefined)?.attio_synced_at ?? null,
      errors: ((errors.data ?? []) as Array<{ id: string; name: string; attio_error: string }>).map((row) => ({
        prospectId: row.id,
        name: row.name,
        error: row.attio_error,
      })),
    }
  } catch {
    return empty
  }
}
