// Veien tilbake: det Casper gjør i Attio, skal gjelde i Proanbud.
//
//   deal flyttet      → status her, og maskinen stopper når han har tatt over
//   deal slettet      → leadet synkes ikke mer (vi lager den ikke igjen)
//   oppgave fullført  → oppgaven her er ferdig
//
// Endringer vi selv har gjort via API-et, ignoreres (actor.type = api-token) —
// ellers ville hver synk utløst en webhook som utløste en ny synk.

import { logServerError } from "@/lib/errors/log"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/integrations/shared/crypto"
import { stopSequence } from "@/lib/outreach/sequence"
import { HUMAN_OWNED_STATUSES, type ProspectRow } from "@/lib/outreach/types"
import { AttioError, attioRequest } from "@/lib/attio/client"
import { statusForStageTitle } from "@/lib/attio/regler"
import { loadAttioContext } from "@/lib/attio/sync"
import { stageTitleOf } from "@/lib/attio/verdier"

type AdminClient = ReturnType<typeof createAdminClient>

export type AttioEvent = {
  event_type?: string
  id?: {
    workspace_id?: string
    object_id?: string
    record_id?: string
    attribute_id?: string
    task_id?: string
  }
  actor?: { type?: string; id?: string | null }
}

/** Hemmeligheten webhooken signeres med: lagret kryptert i oppsettet, ellers fra miljøet. */
export async function loadWebhookSecret(admin: AdminClient): Promise<string | null> {
  const fromEnv = process.env.ATTIO_WEBHOOK_SECRET?.trim() || null
  const { data } = await admin
    .from("selger_settings")
    .select("attio_webhook_secret")
    .eq("id", "global")
    .maybeSingle<{ attio_webhook_secret: string | null }>()
  if (data?.attio_webhook_secret) {
    try {
      return decryptSecret(data.attio_webhook_secret) || fromEnv
    } catch {
      return fromEnv
    }
  }
  return fromEnv
}

async function handleDealUpdated(admin: AdminClient, recordId: string): Promise<string> {
  const { data: prospect } = await admin
    .from("prospects")
    .select("*")
    .eq("attio_deal_id", recordId)
    .maybeSingle<ProspectRow>()
  if (!prospect) return "ukjent deal"

  const record = await attioRequest(`/v2/objects/deals/records/${recordId}`)
  const status = statusForStageTitle(stageTitleOf(record))
  if (!status) return "ukjent steg"

  // Attio sender en hendelse for HVER endring på dealen — også når Casper bare
  // retter navnet. Bare når steget er et annet enn det vi sist var enige om,
  // har han flyttet den. Ellers kunne en status Proanbud ennå ikke har rukket å
  // sende (et svar kom inn, noen meldte seg av), blitt satt tilbake.
  if (!prospect.attio_stage) return "venter på første synk"
  if (status === prospect.attio_stage) return "steget er uendret"

  const now = new Date().toISOString()

  if (status === prospect.status) {
    await admin.from("prospects").update({ attio_stage: status }).eq("id", prospect.id)
    return "uendret"
  }

  // attio_stage settes sammen med statusen, så synken ikke sender steget
  // tilbake. Bare hvis statusen fortsatt er den vi leste — ellers har noe annet
  // endret den i mellomtiden, og da er det den som gjelder.
  const { data: updated } = await admin
    .from("prospects")
    .update({
      status,
      attio_stage: status,
      stage_entered_at: now,
      last_activity_at: now,
      updated_at: now,
    })
    .eq("id", prospect.id)
    .eq("status", prospect.status)
    .select("id")
  if (!updated || updated.length === 0) return "statusen endret seg samtidig — hoppet over"

  // Har han tatt over — svar, demo, prøve, kunde, tapt — skal maskinen ikke
  // sende mer. Utsendingen sjekker dette også, men da blir planlagte meldinger
  // liggende; her kanselleres de.
  if (HUMAN_OWNED_STATUSES.has(status)) {
    await stopSequence(admin, prospect.id, "pipeline")
  }

  await logSellerActivity({
    sellerUserId: null,
    action: status === "kunde" ? "won_prospect" : status === "tapt" ? "lost_prospect" : "update_prospect_status",
    targetType: "prospect",
    targetId: prospect.id,
    metadata: {
      companyName: prospect.name,
      from: prospect.status,
      to: status,
      status,
      via: "attio",
      ...(status === "tapt" ? { lostReason: "annet", note: "Flyttet til Tapt i Attio" } : {}),
    },
  })

  return `status ${prospect.status} → ${status}`
}

async function handleDealDeleted(admin: AdminClient, recordId: string): Promise<string> {
  const { data } = await admin
    .from("prospects")
    .update({ attio_ignored: true, attio_deal_id: null, attio_stage: null, attio_hash: null })
    .eq("attio_deal_id", recordId)
    .select("id")
  return data && data.length > 0 ? "deal slettet — synkes ikke mer" : "ukjent deal"
}

async function handleTaskUpdated(admin: AdminClient, taskId: string): Promise<string> {
  const { data: link } = await admin
    .from("attio_links")
    .select("local_id, prospect_id, state")
    .eq("kind", "oppgave")
    .eq("attio_id", taskId)
    .maybeSingle<{ local_id: string; prospect_id: string | null; state: string | null }>()
  if (!link) return "ukjent oppgave"
  if (link.state === "ferdig") return "allerede ferdig"

  const task = await attioRequest<{ data?: { is_completed?: boolean } }>(`/v2/tasks/${taskId}`)
  if (!task?.data?.is_completed) return "ikke fullført"

  const now = new Date().toISOString()
  // Merk lenken først, så oppdateringen av oppgaven ikke sendes tilbake.
  await admin.from("attio_links").update({ state: "ferdig" }).eq("kind", "oppgave").eq("local_id", link.local_id)
  const { data: done } = await admin
    .from("prospect_tasks")
    .update({ done_at: now, updated_at: now })
    .eq("id", link.local_id)
    .is("done_at", null)
    .select("id, title")

  if (done && done.length > 0 && link.prospect_id) {
    await logSellerActivity({
      sellerUserId: null,
      action: "task_done",
      targetType: "prospect",
      targetId: link.prospect_id,
      metadata: { via: "attio", title: (done[0] as { title: string | null }).title },
    })
  }
  return "oppgave fullført"
}

export type EventOutcome = { result: string; retry: boolean }

/**
 * Behandler én hendelse. Kaster ikke. En hendelse vi ikke forstår, gir 200 —
 * ellers prøver Attio igjen i tre døgn. Et forbigående problem (Attio svarte
 * ikke da vi hentet dealen) gir retry, så endringen ikke går tapt.
 */
export async function handleAttioEvent(event: AttioEvent): Promise<EventOutcome> {
  // Våre egne endringer. Webhooken filtrerer dem bort allerede (db-oppsettet),
  // men vi stoler ikke blindt på filteret.
  if (event.actor?.type === "api-token") return { result: "egen endring", retry: false }

  const admin = createAdminClient()
  try {
    const type = event.event_type ?? ""

    if (type === "task.updated" && event.id?.task_id) {
      return { result: await handleTaskUpdated(admin, event.id.task_id), retry: false }
    }

    if ((type === "record.updated" || type === "record.deleted") && event.id?.record_id) {
      const ctx = await loadAttioContext(admin)
      if (!ctx.dealsObjectId || event.id.object_id !== ctx.dealsObjectId) {
        return { result: "ikke en deal", retry: false }
      }
      const result =
        type === "record.updated"
          ? await handleDealUpdated(admin, event.id.record_id)
          : await handleDealDeleted(admin, event.id.record_id)
      return { result, retry: false }
    }

    return { result: "ignorert", retry: false }
  } catch (error) {
    const transient =
      error instanceof AttioError && (error.status === 0 || error.status === 429 || error.status >= 500)
    void logServerError({
      message: "Webhook fra Attio kunne ikke behandles",
      level: "warning",
      source: "api",
      route: "POST /api/webhooks/attio",
      error,
      context: { eventType: event.event_type ?? null },
    })
    return { result: "feilet", retry: transient }
  }
}
