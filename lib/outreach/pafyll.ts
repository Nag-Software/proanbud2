// Påfyll: maskinen henter nye firmaer selv.
//
// Før dette startet maskinen bare fra det Casper hadde importert for hånd. Var
// lista tom — og det var den — gikk ticken hver dag uten å gjøre noe som helst.
//
// Porsjonen er målgruppen og ingenting annet: AS med 5–20 ansatte, mva-
// registrert, ikke konkurs, med e-postadresse i Brønnøysund (uten den kan
// maskinen ikke skrive, og research koster bare for dem som kan få e-post).
// Portene kjøres med én gang i importen, så bare de som faktisk kan få e-post,
// går videre til research.

import { logServerError } from "@/lib/errors/log"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { createAdminClient } from "@/lib/supabase/admin"
import { importProspects } from "@/lib/outreach/import"
import { refillDecision, REFILL_BATCH } from "@/lib/outreach/pafyll-regler"
import { getSegment, type SegmentKey } from "@/lib/outreach/segments"
import { startOfOsloDayIso } from "@/lib/outreach/send"

type AdminClient = ReturnType<typeof createAdminClient>

export type RefillSummary = {
  attempted: boolean
  reason: string
  segment: SegmentKey
  /** Drivstoff før påfyllet. */
  fuel: number
  imported: number
  emailOk: number
  phoneOnly: number
}

/** Firmaer som kan få e-post og som maskinen ennå ikke har skrevet til. */
async function countFuel(admin: AdminClient, segment: SegmentKey): Promise<number> {
  const { count } = await admin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("segment", segment)
    .eq("contact_policy", "epost_ok")
    .in("pipeline_state", ["kilde", "venter_research", "research", "kvalifisert"])
  return count ?? 0
}

/**
 * Henter en porsjon fra Brønnøysund hvis maskinen er i ferd med å gå tom.
 * Kaster aldri — et feilet påfyll skal ikke velte ticken.
 */
export async function refillIfLow(options: {
  segment?: SegmentKey | null
  capacity: number
  manual?: boolean
}): Promise<RefillSummary> {
  const segment = getSegment(options.segment ?? "handverker")
  const empty: RefillSummary = {
    attempted: false,
    reason: "",
    segment: segment.key,
    fuel: 0,
    imported: 0,
    emailOk: 0,
    phoneOnly: 0,
  }

  try {
    const admin = createAdminClient()
    const fuel = await countFuel(admin, segment.key)

    const [last, today] = await Promise.all([
      admin
        .from("seller_activity_log")
        .select("created_at")
        .eq("action", "auto_import")
        .order("created_at", { ascending: false })
        .limit(1),
      admin
        .from("seller_activity_log")
        .select("id", { count: "exact", head: true })
        .eq("action", "auto_import")
        .gte("created_at", startOfOsloDayIso()),
    ])

    const decision = refillDecision({
      fuel,
      capacity: options.capacity,
      lastRefillAt: ((last.data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null,
      refillsToday: today.count ?? 0,
      now: new Date(),
      manual: options.manual,
    })
    if (!decision.refill) return { ...empty, reason: decision.reason, fuel }

    const result = await importProspects(admin, {
      naeringskoder: segment.naeringskoder,
      segment: segment.key,
      count: REFILL_BATCH,
      onlyWithEmail: true,
    })

    await logSellerActivity({
      sellerUserId: null,
      action: "auto_import",
      targetType: "prospects",
      metadata: {
        segment: segment.key,
        fuel_before: fuel,
        fetched: result.fetched,
        imported: result.imported,
        email_ok: result.emailOk,
        phone_only: result.phoneOnly,
      },
    })

    return {
      attempted: true,
      reason: decision.reason,
      segment: segment.key,
      fuel,
      imported: result.imported,
      emailOk: result.emailOk,
      phoneOnly: result.phoneOnly,
    }
  } catch (error) {
    void logServerError({
      message: "Påfyll fra Brønnøysund feilet",
      level: "warning",
      source: "worker",
      error,
      context: { segment: segment.key },
    })
    return { ...empty, reason: error instanceof Error ? error.message : "Ukjent feil" }
  }
}
