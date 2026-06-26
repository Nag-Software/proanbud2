import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"

import { type OfferActivityEvent } from "@/lib/tilbud/offer-activity.shared"

export { OFFER_ACTIVITY, getOfferActivityTone, type OfferActivityEvent } from "@/lib/tilbud/offer-activity.shared"

type LogOfferActivityInput = {
  offerId: string
  companyId: string
  eventType: string
  title: string
  description?: string | null
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}

/**
 * Logs an offer-activity event. Public (unauthenticated) call sites — customer
 * VIEWED/ACCEPTED/REJECTED/MESSAGE — MUST pass `{ admin: true }`: the anon cookie
 * client has no company, so RLS silently rejects the insert and the activity feed
 * never records the most important customer events. The insert always carries an
 * explicit company_id, so the admin client stays correctly tenant-scoped.
 */
export async function logOfferActivity(
  input: LogOfferActivityInput,
  options?: { admin?: boolean }
) {
  const supabase = options?.admin ? createAdminClient() : await createClient()

  const { data, error } = await supabase
    .from("offer_activity")
    .insert({
      offer_id: input.offerId,
      company_id: input.companyId,
      event_type: input.eventType,
      title: input.title,
      description: input.description || null,
      metadata: input.metadata || {},
      actor_user_id: input.actorUserId || null,
    })
    .select("id, event_type, title, description, metadata, actor_user_id, created_at")
    .single()

  if (error) {
    console.error("[offer_activity]", error.message)
    await logServerError({
      message: "Failed to log offer activity event",
      error,
      source: "server",
      route: "logOfferActivity",
      level: "warning",
      companyId: input.companyId,
      userId: input.actorUserId ?? undefined,
      context: { offerId: input.offerId, eventType: input.eventType },
    })
    return null
  }

  return {
    id: Number(data.id),
    eventType: String(data.event_type),
    title: String(data.title),
    description: data.description ? String(data.description) : null,
    metadata: (data.metadata as Record<string, unknown>) || {},
    actorUserId: data.actor_user_id ? String(data.actor_user_id) : null,
    createdAt: String(data.created_at),
  } satisfies OfferActivityEvent
}

export async function fetchOfferActivity(offerId: string, companyId: string, limit = 100) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("offer_activity")
    .select("id, event_type, title, description, metadata, actor_user_id, created_at")
    .eq("offer_id", offerId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[offer_activity fetch]", error.message)
    await logServerError({
      message: "Failed to fetch offer activity",
      error,
      source: "server",
      route: "fetchOfferActivity",
      level: "warning",
      companyId,
      context: { offerId },
    })
    return []
  }

  return (data || []).map((row) => ({
    id: Number(row.id),
    eventType: String(row.event_type),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    createdAt: String(row.created_at),
  })) satisfies OfferActivityEvent[]
}
