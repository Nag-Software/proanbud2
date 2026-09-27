// Oppsettet: gjør Attio-workspacet klart for synken, fra én knapp i
// /selger/innstillinger. Kan kjøres så mange ganger man vil — hvert steg
// sjekker hva som finnes før det lager noe.
//
//   1. nøkkelen er gyldig og har tilgangene synken trenger
//   2. Deals er skrudd på (det må en admin gjøre i Attio)
//   3. egne felt: Proanbud-ID, org.nr., telefon, lenke til lead-kortet, kilde
//   4. deal-stegene våre (Lead, Kontaktet, Dialog, Demo, Trial, Vunnet, Tapt)
//   5. eieren av dealene: ATTIO_OWNER_EMAIL, ellers den som laget nøkkelen
//   6. webhooken tilbake, med hemmeligheten lagret kryptert
//   7. alle varme og aktive leads legges i køen

import { createAdminClient } from "@/lib/supabase/admin"
import { encryptSecret } from "@/lib/integrations/shared/crypto"
import type { ProspectRow } from "@/lib/outreach/types"
import { AttioError, attioRequest, getAttioApiKey } from "@/lib/attio/client"
import { missingScopes, shouldSyncProspect, STAGE_ORDER, STAGE_TITLES } from "@/lib/attio/regler"
import { appUrl } from "@/lib/attio/sync"
import { CUSTOM_ATTRIBUTES } from "@/lib/attio/verdier"

type AdminClient = ReturnType<typeof createAdminClient>

export type SetupStep = { step: string; ok: boolean; detail: string }

export type SetupReport = {
  ok: boolean
  workspace: string | null
  steps: SetupStep[]
  queued: number
  /** Bare når hemmeligheten ikke kunne lagres kryptert: Casper må legge den i miljøet selv. */
  webhookSecretToStore: string | null
}

type SelfResponse = {
  active?: boolean
  scope?: string
  workspace_name?: string
  authorized_by_workspace_member_id?: string | null
}

type AttributeRow = { api_slug?: string; is_archived?: boolean; id?: { attribute_id?: string } }
type StatusRow = { title?: string; is_archived?: boolean; id?: { status_id?: string } }
type MemberRow = { id?: { workspace_member_id?: string }; email_address?: string; access_level?: string }

async function ensureAttributes(object: "companies" | "deals"): Promise<string> {
  const listed = await attioRequest<{ data?: AttributeRow[] }>(`/v2/objects/${object}/attributes`, {
    query: { show_archived: "true", limit: "500" },
  })
  const bySlug = new Map((listed?.data ?? []).map((row) => [row.api_slug ?? "", row]))
  const created: string[] = []

  for (const attribute of CUSTOM_ATTRIBUTES[object]) {
    const existing = bySlug.get(attribute.api_slug)
    if (existing) {
      if (existing.is_archived) {
        await attioRequest(`/v2/objects/${object}/attributes/${attribute.api_slug}`, {
          method: "PATCH",
          body: { data: { is_archived: false } },
        })
        created.push(`${attribute.title} (hentet fram igjen)`)
      }
      continue
    }
    try {
      await attioRequest(`/v2/objects/${object}/attributes`, {
        method: "POST",
        body: {
          data: {
            title: attribute.title,
            description: "Synkes fra Proanbud",
            api_slug: attribute.api_slug,
            type: attribute.type,
            is_required: false,
            is_unique: attribute.is_unique,
            is_multiselect: false,
            config: {},
          },
        },
      })
      created.push(attribute.title)
    } catch (error) {
      // 409 slug_conflict: finnes allerede (kappløp) — det er målet.
      if (!(error instanceof AttioError && error.status === 409)) throw error
    }
  }

  return created.length > 0 ? `La til ${created.join(", ")}` : "Alle felt finnes"
}

async function ensureStages(): Promise<string> {
  const listed = await attioRequest<{ data?: StatusRow[] }>(`/v2/objects/deals/attributes/stage/statuses`, {
    query: { show_archived: "true" },
  })
  const byTitle = new Map((listed?.data ?? []).map((row) => [(row.title ?? "").toLowerCase(), row]))
  const changed: string[] = []

  for (const status of STAGE_ORDER) {
    const title = STAGE_TITLES[status]
    const existing = byTitle.get(title.toLowerCase())
    if (existing) {
      if (existing.is_archived && existing.id?.status_id) {
        await attioRequest(`/v2/objects/deals/attributes/stage/statuses/${existing.id.status_id}`, {
          method: "PATCH",
          body: { data: { is_archived: false } },
        })
        changed.push(`${title} (hentet fram igjen)`)
      }
      continue
    }
    try {
      await attioRequest(`/v2/objects/deals/attributes/stage/statuses`, {
        method: "POST",
        body: { data: { title } },
      })
      changed.push(title)
    } catch (error) {
      if (!(error instanceof AttioError && error.status === 409)) throw error
    }
  }

  return changed.length > 0 ? `La til ${changed.join(", ")}` : "Alle steg finnes"
}

/** Eieren av dealene og oppgavene: ATTIO_OWNER_EMAIL, ellers den som laget nøkkelen. */
async function resolveOwner(self: SelfResponse): Promise<{ memberId: string; email: string | null }> {
  const members = await attioRequest<{ data?: MemberRow[] }>(`/v2/workspace_members`)
  const wanted = process.env.ATTIO_OWNER_EMAIL?.trim().toLowerCase() || null

  const match = wanted
    ? (members?.data ?? []).find((member) => member.email_address?.toLowerCase() === wanted)
    : (members?.data ?? []).find(
        (member) => member.id?.workspace_member_id === self.authorized_by_workspace_member_id,
      )

  const memberId = match?.id?.workspace_member_id
  if (!memberId) {
    throw new AttioError(
      wanted
        ? `Fant ingen i Attio-workspacet med e-posten i ATTIO_OWNER_EMAIL`
        : "Fant ikke hvem som laget nøkkelen — sett ATTIO_OWNER_EMAIL",
      400,
      "eier_mangler",
    )
  }
  return { memberId, email: match?.email_address ?? null }
}

/** Webhooken tilbake. Finnes den allerede mot samme adresse, beholdes den. */
async function ensureWebhook(
  admin: AdminClient,
  dealsObjectId: string,
): Promise<{ detail: string; secretToStore: string | null }> {
  const targetUrl = new URL("/api/webhooks/attio", appUrl()).toString()
  if (!targetUrl.startsWith("https://")) {
    return { detail: `Hoppet over — Attio krever HTTPS (${targetUrl}). Kjør oppsettet i produksjon.`, secretToStore: null }
  }

  const { data: settings } = await admin
    .from("selger_settings")
    .select("attio_webhook_id")
    .eq("id", "global")
    .maybeSingle<{ attio_webhook_id: string | null }>()

  if (settings?.attio_webhook_id) {
    try {
      const existing = await attioRequest<{ data?: { target_url?: string; status?: string } }>(
        `/v2/webhooks/${settings.attio_webhook_id}`,
      )
      if (existing?.data?.target_url === targetUrl) {
        return { detail: `Finnes (${existing.data.status ?? "ukjent status"})`, secretToStore: null }
      }
      await attioRequest(`/v2/webhooks/${settings.attio_webhook_id}`, { method: "DELETE" })
    } catch (error) {
      if (!(error instanceof AttioError && error.isNotFound)) throw error
    }
  }

  // Våre egne endringer (api-token) filtreres bort i Attio, så hver synk ikke
  // utløser en webhook tilbake. Koden ignorerer dem også.
  const notOurs = { field: "actor.type", operator: "not_equals", value: "api-token" }
  const dealsOnly = { field: "id.object_id", operator: "equals", value: dealsObjectId }
  const created = await attioRequest<{ data?: { id?: { webhook_id?: string }; secret?: string } }>(`/v2/webhooks`, {
    method: "POST",
    body: {
      data: {
        target_url: targetUrl,
        subscriptions: [
          { event_type: "record.updated", filter: { $and: [dealsOnly, notOurs] } },
          { event_type: "record.deleted", filter: { $and: [dealsOnly, notOurs] } },
          { event_type: "task.updated", filter: { $and: [notOurs] } },
        ],
      },
    },
  })

  const webhookId = created?.data?.id?.webhook_id ?? null
  const secret = created?.data?.secret ?? null
  if (!webhookId || !secret) throw new AttioError("Attio returnerte ikke webhook-id og hemmelighet", 500, null)

  let encrypted: string | null = null
  try {
    encrypted = encryptSecret(secret)
  } catch {
    encrypted = null
  }

  await admin
    .from("selger_settings")
    .update({ attio_webhook_id: webhookId, attio_webhook_secret: encrypted })
    .eq("id", "global")

  return encrypted
    ? { detail: "Laget", secretToStore: null }
    : {
        detail: "Laget, men hemmeligheten kunne ikke krypteres — legg den i ATTIO_WEBHOOK_SECRET",
        secretToStore: secret,
      }
}

/** Legger alle varme og aktive leads i køen. Returnerer antallet. */
export async function backfillAttioQueue(admin: AdminClient): Promise<number> {
  const { data } = await admin.from("prospects").select("*").neq("status", "ny").limit(5000)
  const ids = ((data ?? []) as ProspectRow[]).filter(shouldSyncProspect).map((row) => row.id)
  if (ids.length === 0) return 0

  const now = new Date().toISOString()
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500).map((prospect_id) => ({
      prospect_id,
      queued_at: now,
      attempts: 0,
      last_error: null,
      locked_at: null,
    }))
    await admin.from("attio_outbox").upsert(chunk, { onConflict: "prospect_id" })
  }
  return ids.length
}

export async function setupAttio(): Promise<SetupReport> {
  const report: SetupReport = { ok: false, workspace: null, steps: [], queued: 0, webhookSecretToStore: null }
  const step = (name: string, ok: boolean, detail: string) => report.steps.push({ step: name, ok, detail })

  if (!getAttioApiKey()) {
    step("Nøkkel", false, "ATTIO_API_KEY er ikke satt i miljøet")
    return report
  }

  try {
    // 1) Nøkkelen
    const self = await attioRequest<SelfResponse>(`/v2/self`)
    if (!self?.active) {
      step("Nøkkel", false, "Nøkkelen er ugyldig eller trukket tilbake")
      return report
    }
    report.workspace = self.workspace_name ?? null
    const missing = missingScopes(self.scope ?? "")
    if (missing.length > 0) {
      step("Nøkkel", false, `Mangler tilgang: ${missing.join(", ")}`)
      return report
    }
    step("Nøkkel", true, `Koblet til ${self.workspace_name ?? "workspacet"}`)

    // 2) Deals
    let dealsObjectId: string | null = null
    try {
      const deals = await attioRequest<{ data?: { id?: { object_id?: string } } }>(`/v2/objects/deals`)
      dealsObjectId = deals?.data?.id?.object_id ?? null
    } catch (error) {
      if (!(error instanceof AttioError && (error.isNotFound || error.status === 400))) throw error
    }
    if (!dealsObjectId) {
      step("Deals", false, "Deals er ikke skrudd på. En admin gjør det i Attio: Settings → Objects → Deals.")
      return report
    }
    step("Deals", true, "Skrudd på")

    // 3) Felt
    step("Felt på firmaer", true, await ensureAttributes("companies"))
    step("Felt på deals", true, await ensureAttributes("deals"))

    // 4) Steg
    step("Deal-steg", true, await ensureStages())

    // 5) Eier
    const owner = await resolveOwner(self)
    step("Eier", true, owner.email ? `Dealer og oppgaver eies av ${owner.email}` : "Satt")

    const admin = createAdminClient()
    await admin
      .from("selger_settings")
      .update({ attio_deals_object_id: dealsObjectId, attio_owner_member_id: owner.memberId })
      .eq("id", "global")

    // 6) Webhook
    const webhook = await ensureWebhook(admin, dealsObjectId)
    step("Webhook tilbake", true, webhook.detail)
    report.webhookSecretToStore = webhook.secretToStore

    // 7) Køen
    await admin.from("selger_settings").update({ attio_setup_at: new Date().toISOString() }).eq("id", "global")
    report.queued = await backfillAttioQueue(admin)
    step("Leads", true, `${report.queued} varme og aktive leads lagt i køen`)

    report.ok = true
    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    step("Feil", false, message)
    return report
  }
}
