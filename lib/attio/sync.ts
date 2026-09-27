// Synken Proanbud → Attio.
//
// Køen (attio_outbox, db/104) fylles av databaseutløsere, så denne filen
// trenger ikke vite hvem som endret noe. For hvert lead i køen skrives hele
// tilstanden på nytt: firma, person, deal, nye notater og oppgaver. Det gjør
// synken idempotent — en kjøring som dør midt i, tas bare opp igjen.
//
// Tre ting er bevisst:
//   - Steget skrives bare når statusen har endret seg HER (attio_stage). Ellers
//     ville en gammel endring i køen overskrevet en deal Casper nettopp flyttet.
//   - En uendret deal skrives ikke på nytt (attio_hash).
//   - Notater og oppgaver huskes i attio_links, så ingenting dupliseres.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ProspectRow } from "@/lib/outreach/types"
import { loadAnalyseFacts } from "@/lib/outreach/varm"
import { AttioError, attioRequest, getAttioApiKey } from "@/lib/attio/client"
import {
  activityNote,
  analyseNote,
  emailNote,
  payloadHash,
  replyNote,
  shouldSyncProspect,
  taskContent,
  type NoteDraft,
} from "@/lib/attio/regler"
import {
  companyValues,
  dealValues,
  personEmailFor,
  personValues,
  recordIdOf,
  recordRef,
  type RecordRef,
} from "@/lib/attio/verdier"

type AdminClient = ReturnType<typeof createAdminClient>

/** Kill-switch: ingenting sendes til Attio før Casper har skrudd det på. */
export function isAttioEnabled(): boolean {
  return process.env.ATTIO_SYNC?.trim().toLowerCase() === "on" && Boolean(getAttioApiKey())
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.proanbud.no"
}

/** Maks notater per lead per kjøring. Resten tas neste gang (leadet legges tilbake i køen). */
const NOTES_PER_RUN = 25

export type AttioContext = {
  ownerMemberId: string | null
  dealsObjectId: string | null
  setupAt: string | null
}

export async function loadAttioContext(admin: AdminClient): Promise<AttioContext> {
  const { data } = await admin
    .from("selger_settings")
    .select("attio_owner_member_id, attio_deals_object_id, attio_setup_at")
    .eq("id", "global")
    .maybeSingle<{
      attio_owner_member_id: string | null
      attio_deals_object_id: string | null
      attio_setup_at: string | null
    }>()
  return {
    ownerMemberId: data?.attio_owner_member_id ?? null,
    dealsObjectId: data?.attio_deals_object_id ?? null,
    setupAt: data?.attio_setup_at ?? null,
  }
}

// ── Firma, person, deal ─────────────────────────────────────────────────────

function withoutDomains(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== "domains"))
}

/**
 * Firmaet i Attio. Kjenner vi id-en, oppdateres den. Har vi domenet, finner
 * eller lager vi det på domenet — Attios eneste unike felt på firmaer, og det
 * treffer også firmaer Casper har laget selv. Uten domene slår vi opp på
 * Proanbud-ID-en før vi lager et nytt, så det ikke blir to.
 */
async function upsertCompany(prospect: ProspectRow): Promise<string> {
  const values = companyValues(prospect)

  if (prospect.attio_company_id) {
    try {
      await attioRequest(`/v2/objects/companies/records/${prospect.attio_company_id}`, {
        method: "PATCH",
        body: { data: { values } },
      })
      return prospect.attio_company_id
    } catch (error) {
      // Domenet tilhører et annet firma i Attio. Skriv resten, og la domenet være.
      if (error instanceof AttioError && error.isConflict && values.domains) {
        await attioRequest(`/v2/objects/companies/records/${prospect.attio_company_id}`, {
          method: "PATCH",
          body: { data: { values: withoutDomains(values) } },
        })
        return prospect.attio_company_id
      }
      // Slettet i Attio — finn eller lag det på nytt under.
      if (!(error instanceof AttioError && error.isNotFound)) throw error
    }
  }

  if (values.domains) {
    const response = await attioRequest(`/v2/objects/companies/records`, {
      method: "PUT",
      query: { matching_attribute: "domains" },
      body: { data: { values } },
    })
    const id = recordIdOf(response)
    if (!id) throw new AttioError("Attio returnerte ikke firma-id", 500, null)
    return id
  }

  const found = await attioRequest<{ data?: Array<{ id?: { record_id?: string } }> }>(
    `/v2/objects/companies/records/query`,
    { method: "POST", body: { filter: { proanbud_id: prospect.id }, limit: 1 } },
  )
  const existingId = found?.data?.[0]?.id?.record_id
  if (existingId) {
    await attioRequest(`/v2/objects/companies/records/${existingId}`, {
      method: "PATCH",
      body: { data: { values } },
    })
    return existingId
  }

  const created = await attioRequest(`/v2/objects/companies/records`, {
    method: "POST",
    body: { data: { values } },
  })
  const id = recordIdOf(created)
  if (!id) throw new AttioError("Attio returnerte ikke firma-id", 500, null)
  return id
}

/** Personen som krysset av, eller en navngitt adresse. Ingen person for post@. */
async function upsertPerson(prospect: ProspectRow, companyId: string | null): Promise<string | null> {
  const email = personEmailFor(prospect)
  if (!email) return prospect.attio_person_id ?? null

  const response = await attioRequest(`/v2/objects/people/records`, {
    method: "PUT",
    query: { matching_attribute: "email_addresses" },
    body: { data: { values: personValues(email, companyId) } },
  })
  return recordIdOf(response) ?? prospect.attio_person_id ?? null
}

/**
 * Hash av alt vi skriver om leadet (uten steget, som har sin egen regel). Lik
 * forrige gang → firma, person og deal er uendret og skrives ikke på nytt.
 */
export function prospectHash(
  prospect: ProspectRow,
  ids: { companyId: string | null; personId: string | null },
): string {
  return payloadHash({
    company: companyValues(prospect),
    person: personEmailFor(prospect),
    deal: dealValues(prospect, {
      companyId: ids.companyId,
      personId: ids.personId,
      appUrl: appUrl(),
      includeStage: false,
      ownerMemberId: null,
    }),
  })
}

async function upsertDeal(
  prospect: ProspectRow,
  input: { companyId: string | null; personId: string | null; ctx: AttioContext },
): Promise<string> {
  // Steget skrives når statusen har endret seg her siden forrige gang vi var
  // enige med Attio — eller når dealen lages.
  const stageChanged = prospect.attio_stage !== prospect.status
  const creating = !prospect.attio_deal_id

  const values = dealValues(prospect, {
    companyId: input.companyId,
    personId: input.personId,
    appUrl: appUrl(),
    includeStage: creating || stageChanged,
    // Eieren settes når dealen lages. Etterpå er det Caspers å flytte.
    ownerMemberId: creating ? input.ctx.ownerMemberId : null,
  })

  if (!creating) {
    try {
      await attioRequest(`/v2/objects/deals/records/${prospect.attio_deal_id}`, {
        method: "PATCH",
        body: { data: { values } },
      })
      return prospect.attio_deal_id!
    } catch (error) {
      if (!(error instanceof AttioError && error.isNotFound)) throw error
      // Borte i Attio uten at webhooken fortalte oss det — lag den på nytt.
    }
  }

  const response = await attioRequest(`/v2/objects/deals/records`, {
    method: "PUT",
    query: { matching_attribute: "proanbud_id" },
    body: {
      data: {
        values: dealValues(prospect, {
          companyId: input.companyId,
          personId: input.personId,
          appUrl: appUrl(),
          includeStage: true,
          ownerMemberId: input.ctx.ownerMemberId,
        }),
      },
    },
  })
  const dealId = recordIdOf(response)
  if (!dealId) throw new AttioError("Attio returnerte ikke deal-id", 500, null)
  return dealId
}

// ── Notater og oppgaver ─────────────────────────────────────────────────────

type LinkRow = { kind: string; local_id: string; attio_id: string; state: string | null }

async function loadLinks(admin: AdminClient, prospectId: string): Promise<Map<string, LinkRow>> {
  const { data } = await admin
    .from("attio_links")
    .select("kind, local_id, attio_id, state")
    .eq("prospect_id", prospectId)
  const links = new Map<string, LinkRow>()
  for (const row of (data ?? []) as LinkRow[]) links.set(`${row.kind}:${row.local_id}`, row)
  return links
}

async function createNote(dealId: string, note: NoteDraft): Promise<string | null> {
  const response = await attioRequest<{ data?: { id?: { note_id?: string } } }>(`/v2/notes`, {
    method: "POST",
    body: {
      data: {
        parent_object: "deals",
        parent_record_id: dealId,
        title: note.title,
        format: "plaintext",
        content: note.content || " ",
        ...(note.createdAt ? { created_at: note.createdAt } : {}),
      },
    },
  })
  return response?.data?.id?.note_id ?? null
}

/**
 * Nye notater: e-post vi har sendt, svar vi har fått, samtaler og notater fra
 * lead-kortet, og analysen. Returnerer true hvis det gjenstår flere enn vi
 * rakk denne gangen.
 */
async function syncNotes(
  admin: AdminClient,
  prospect: ProspectRow,
  dealId: string,
  links: Map<string, LinkRow>,
): Promise<boolean> {
  const pending: Array<{ kind: string; localId: string; note: NoteDraft }> = []

  if (prospect.analyse_lead_id && !links.has(`analyse:${prospect.analyse_lead_id}`)) {
    const facts = await loadAnalyseFacts(admin, prospect.analyse_lead_id)
    if (facts) pending.push({ kind: "analyse", localId: facts.id, note: analyseNote(facts) })
  }

  const [emails, replies, activities] = await Promise.all([
    admin
      .from("seller_email_log")
      .select("id, subject, body, recipient_email, template_id, created_at")
      .eq("prospect_id", prospect.id)
      .order("created_at", { ascending: true })
      .limit(100),
    admin
      .from("inbound_emails")
      .select("id, from_email, from_name, subject, classification, summary, text_body, received_at")
      .eq("prospect_id", prospect.id)
      .order("received_at", { ascending: true })
      .limit(100),
    admin
      .from("seller_activity_log")
      .select("id, action, metadata, created_at")
      .eq("target_id", prospect.id)
      .in("action", ["phone_call", "note", "won_prospect", "lost_prospect"])
      .order("created_at", { ascending: true })
      .limit(100),
  ])

  for (const row of (emails.data ?? []) as Array<Parameters<typeof emailNote>[0] & { id: string }>) {
    if (!links.has(`epost:${row.id}`)) pending.push({ kind: "epost", localId: row.id, note: emailNote(row) })
  }
  for (const row of (replies.data ?? []) as Array<Parameters<typeof replyNote>[0] & { id: string }>) {
    if (!links.has(`svar:${row.id}`)) pending.push({ kind: "svar", localId: row.id, note: replyNote(row) })
  }
  for (const row of (activities.data ?? []) as Array<Parameters<typeof activityNote>[0] & { id: string }>) {
    if (links.has(`aktivitet:${row.id}`)) continue
    const note = activityNote(row)
    // Ingen notat (f.eks. en endring som kom fra Attio) — husk den likevel,
    // så den ikke vurderes på nytt hver gang.
    if (!note) {
      await admin
        .from("attio_links")
        .upsert({ kind: "aktivitet", local_id: row.id, prospect_id: prospect.id, attio_id: "-" })
      continue
    }
    pending.push({ kind: "aktivitet", localId: row.id, note })
  }

  pending.sort((a, b) => (a.note.createdAt ?? "").localeCompare(b.note.createdAt ?? ""))

  for (const item of pending.slice(0, NOTES_PER_RUN)) {
    const noteId = await createNote(dealId, item.note)
    await admin.from("attio_links").upsert({
      kind: item.kind,
      local_id: item.localId,
      prospect_id: prospect.id,
      attio_id: noteId ?? "-",
    })
  }

  return pending.length > NOTES_PER_RUN
}

/**
 * Oppgaver: åpne oppgaver lages i Attio, og en oppgave som er fullført her,
 * fullføres der. Oppgaver som var ferdige før de ble synket, lages ikke.
 */
async function syncTasks(
  admin: AdminClient,
  prospect: ProspectRow,
  ids: { dealId: string; companyId: string | null },
  links: Map<string, LinkRow>,
  ctx: AttioContext,
): Promise<void> {
  const { dealId, companyId } = ids
  const { data } = await admin
    .from("prospect_tasks")
    .select("id, task_type, title, note, due_at, done_at")
    .eq("prospect_id", prospect.id)
    .order("created_at", { ascending: true })
    .limit(50)

  for (const task of (data ?? []) as Array<{
    id: string
    task_type: string
    title: string | null
    note: string | null
    due_at: string
    done_at: string | null
  }>) {
    const link = links.get(`oppgave:${task.id}`)

    if (!link) {
      if (task.done_at) continue
      const createTask = (linked: RecordRef[]) =>
        attioRequest<{ data?: { id?: { task_id?: string } } }>(`/v2/tasks`, {
          method: "POST",
          body: {
            data: {
              // Attio tar maks 2000 tegn, ren tekst.
              content: taskContent(task, prospect.name).slice(0, 2000),
              format: "plaintext",
              deadline_at: task.due_at,
              is_completed: false,
              linked_records: linked,
              assignees: ctx.ownerMemberId
                ? [{ referenced_actor_type: "workspace-member", referenced_actor_id: ctx.ownerMemberId }]
                : [],
            },
          },
        })

      // Dealen og firmaet. Attios dokumentasjon er uklar på om oppgaver kan
      // kobles til deals — avviser den det, kobles oppgaven til firmaet.
      const linked = [recordRef("deals", dealId), ...(companyId ? [recordRef("companies", companyId)] : [])]
      let response: { data?: { id?: { task_id?: string } } }
      try {
        response = await createTask(linked)
      } catch (error) {
        if (!(error instanceof AttioError) || error.status !== 400 || !companyId) throw error
        response = await createTask([recordRef("companies", companyId)])
      }
      const taskId = response?.data?.id?.task_id
      if (taskId) {
        await admin.from("attio_links").upsert({
          kind: "oppgave",
          local_id: task.id,
          prospect_id: prospect.id,
          attio_id: taskId,
          state: "aapen",
        })
      }
      continue
    }

    if (task.done_at && link.state !== "ferdig" && link.attio_id !== "-") {
      try {
        await attioRequest(`/v2/tasks/${link.attio_id}`, {
          method: "PATCH",
          body: { data: { is_completed: true } },
        })
      } catch (error) {
        // Slettet i Attio: da er den like ferdig.
        if (!(error instanceof AttioError && error.isNotFound)) throw error
      }
      await admin
        .from("attio_links")
        .update({ state: "ferdig" })
        .eq("kind", "oppgave")
        .eq("local_id", task.id)
    }
  }
}

// ── Ett lead ────────────────────────────────────────────────────────────────

export type ProspectSyncOutcome = "synket" | "hoppet_over" | "borte"

/** Synker ett lead. Kaster AttioError ved feil — kalleren logger og går videre. */
export async function syncProspect(
  admin: AdminClient,
  prospectId: string,
  ctx: AttioContext,
): Promise<{ outcome: ProspectSyncOutcome; more: boolean }> {
  const { data: prospect } = await admin
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle<ProspectRow>()

  if (!prospect) return { outcome: "borte", more: false }
  if (!shouldSyncProspect(prospect)) return { outcome: "hoppet_over", more: false }

  // Uendret siden sist (samme hash, samme steg, og alt finnes i Attio)? Da
  // skrives ikke firma, person og deal — bare nye notater og oppgaver.
  const unchanged =
    Boolean(prospect.attio_deal_id && prospect.attio_company_id) &&
    prospect.attio_stage === prospect.status &&
    prospectHash(prospect, {
      companyId: prospect.attio_company_id ?? null,
      personId: prospect.attio_person_id ?? null,
    }) === prospect.attio_hash

  let companyId = prospect.attio_company_id ?? null
  let personId = prospect.attio_person_id ?? null
  let dealId = prospect.attio_deal_id ?? null
  if (!unchanged || !dealId) {
    companyId = await upsertCompany(prospect)
    personId = await upsertPerson(prospect, companyId)
    dealId = await upsertDeal(prospect, { companyId, personId, ctx })
  }
  const hash = prospectHash(prospect, { companyId, personId })
  if (!dealId) throw new AttioError("Fant ingen deal i Attio", 500, null)

  const links = await loadLinks(admin, prospect.id)
  const more = await syncNotes(admin, prospect, dealId, links)
  await syncTasks(admin, prospect, { dealId, companyId }, links, ctx)

  await admin
    .from("prospects")
    .update({
      attio_company_id: companyId,
      attio_person_id: personId,
      attio_deal_id: dealId,
      attio_stage: prospect.status,
      attio_hash: hash,
      attio_synced_at: new Date().toISOString(),
      attio_error: null,
    })
    .eq("id", prospect.id)

  return { outcome: "synket", more }
}

// ── Køen ────────────────────────────────────────────────────────────────────

export type AttioSyncSummary = {
  ok: boolean
  claimed: number
  synced: number
  skipped: number
  failed: number
  notes: string[]
  duration_ms: number
}

type Claimed = { prospect_id: string; queued_at: string; attempts: number }

/** Ferdig: fjern raden — med mindre leadet ble lagt i køen på nytt mens vi jobbet. */
async function complete(admin: AdminClient, row: Claimed): Promise<void> {
  const { data } = await admin
    .from("attio_outbox")
    .delete()
    .eq("prospect_id", row.prospect_id)
    .eq("queued_at", row.queued_at)
    .select("prospect_id")
  if (!data || data.length === 0) {
    await admin.from("attio_outbox").update({ locked_at: null }).eq("prospect_id", row.prospect_id)
  }
}

async function fail(admin: AdminClient, row: Claimed, message: string): Promise<void> {
  // locked_at blir stående: neste forsøk kommer når leasen går ut (2 min).
  await admin.from("attio_outbox").update({ last_error: message }).eq("prospect_id", row.prospect_id)
  await admin.from("prospects").update({ attio_error: message }).eq("id", row.prospect_id)
}

async function release(admin: AdminClient, rows: Claimed[]): Promise<void> {
  if (rows.length === 0) return
  await admin
    .from("attio_outbox")
    .update({ locked_at: null })
    .in("prospect_id", rows.map((row) => row.prospect_id))
}

/**
 * Tømmer køen innenfor en tidsboks. Kaster aldri: en feil på ett lead stopper
 * ikke de andre, og en ugyldig nøkkel stopper kjøringen pent.
 */
export async function runAttioSync(options: { budgetMs?: number; limit?: number } = {}): Promise<AttioSyncSummary> {
  const started = Date.now()
  const deadline = started + (options.budgetMs ?? 100_000)
  const summary: AttioSyncSummary = {
    ok: false,
    claimed: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    notes: [],
    duration_ms: 0,
  }

  try {
    if (!isAttioEnabled()) {
      summary.notes.push("Attio-synk er ikke skrudd på (ATTIO_SYNC=on og ATTIO_API_KEY)")
      summary.ok = true
      return summary
    }

    const admin = createAdminClient()
    const ctx = await loadAttioContext(admin)
    if (!ctx.setupAt) {
      summary.notes.push("Attio er ikke satt opp ennå — kjør oppsettet under Selger → Innstillinger")
      summary.ok = true
      return summary
    }

    const { data, error } = await admin.rpc("claim_attio_outbox", {
      p_limit: Math.max(1, Math.min(options.limit ?? 20, 50)),
      p_lease_seconds: 120,
    })
    if (error) {
      summary.notes.push(`Kunne ikke ta fra køen: ${error.message}`)
      return summary
    }

    const claimed = (data ?? []) as Claimed[]
    summary.claimed = claimed.length

    for (let index = 0; index < claimed.length; index++) {
      const row = claimed[index]
      if (Date.now() > deadline) {
        summary.notes.push("Tiden gikk ut — resten tas neste kjøring")
        await release(admin, claimed.slice(index))
        break
      }

      try {
        const result = await syncProspect(admin, row.prospect_id, ctx)
        if (result.outcome === "synket") summary.synced += 1
        else summary.skipped += 1
        await complete(admin, row)
        // Flere notater enn vi rakk? Tilbake i køen, så resten kommer neste minutt.
        if (result.more) await admin.rpc("attio_enqueue", { p_prospect_id: row.prospect_id })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ukjent feil"
        if (error instanceof AttioError && error.isAuth) {
          // Nøkkelen er ugyldig eller mangler tilgang. Da feiler alle —
          // stopp, og la radene ligge til nøkkelen er i orden.
          summary.notes.push(`Attio avviste nøkkelen: ${message}`)
          await release(admin, claimed.slice(index))
          summary.failed += 1
          break
        }
        summary.failed += 1
        summary.notes.push(`${row.prospect_id}: ${message}`)
        await fail(admin, row, message)
      }
    }

    summary.ok = true
    return summary
  } catch (error) {
    void logServerError({
      message: "Attio-synken feilet",
      level: "error",
      source: "worker",
      error,
    })
    summary.notes.push(error instanceof Error ? error.message : "Ukjent feil")
    return summary
  } finally {
    summary.duration_ms = Date.now() - started
  }
}
