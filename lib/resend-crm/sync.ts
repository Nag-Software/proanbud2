// Speiler bedrifter til Resend som kontakter, holder segmentene oppdatert og
// sender events ved overganger. Selve e-postene (sekvenser og kampanjer)
// lages og skrives i Resend — denne koden sørger bare for at riktig person
// er i riktig segment og at automatiseringene får beskjed når noe skjer.
//
// Kalles fra:
//   • billing-synken (upsertCompanyBillingFromSubscription / markCompanyBillingCanceled)
//     — alle prøvestarter, betalinger og kanselleringer går gjennom der
//   • tilbudsutsending (lib/tilbud/send-offer.ts) — første sendte tilbud
//   • daglig cron (/api/cron/resend-crm-sync) — sikkerhetsnett + backfill
//
// KILL-SWITCH: gjør ingenting før RESEND_CRM === "on".
// Best-effort: kaster aldri ut av scheduleResendSync, så en Resend-feil kan
// aldri velte en betaling eller en tilbudsutsending.

import "server-only"
import { createHash } from "crypto"
import { after } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { presentableCompanyName } from "@/lib/lifecycle/schedule"
import { applyWelcomeDiscountToSubscription, ensureWelcomeDiscount } from "@/lib/billing/welcome-discount"
import {
  addToSegment,
  getSegmentIdsByName,
  removeFromSegment,
  sendEvent,
  upsertContact,
  type ContactProperties,
} from "./api"
import { formatTrialEnd, prettyCompanyName } from "./format"
import {
  bucketFor,
  eventsForTransition,
  firstNameOf,
  segmentsFor,
  segmentsToLeave,
  ALL_SEGMENTS,
  type Bucket,
  type SyncState,
} from "./model"

type AdminClient = ReturnType<typeof createAdminClient>

const FRESH_SIGNUP_MS = 48 * 60 * 60 * 1000
/** Velkomstrabatten (80 % første måned) lages når det er så lite igjen av prøven — samme vindu som de gamle påminnelsene. */
const DISCOUNT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000

/**
 * Sørger for at bedriften har velkomstkoden når prøven nærmer seg slutten, så
 * {{rabattkode}} er fylt ut når automatiseringen sender «3 dager igjen».
 * Stripe-bivirkning (lager kode og fester den på abonnementet) — feiler stille.
 */
async function ensureDiscountCode(companyId: string, trialEndsAt: string | null): Promise<string | null> {
  if (!trialEndsAt) return null
  const msLeft = new Date(trialEndsAt).getTime() - Date.now()
  if (msLeft > DISCOUNT_WINDOW_MS || msLeft < 0) return null
  try {
    const discount = await ensureWelcomeDiscount(companyId)
    if (!discount) return null
    await applyWelcomeDiscountToSubscription(companyId, discount)
    return discount.code
  } catch (error) {
    void logServerError({
      message: "Resend-synk: velkomstrabatt kunne ikke opprettes",
      error,
      level: "warning",
      source: "server",
      route: "ensureDiscountCode",
      companyId,
    })
    return null
  }
}

export function isResendCrmEnabled(): boolean {
  return process.env.RESEND_CRM?.trim().toLowerCase() === "on"
}

export type SyncOutcome =
  | { status: "off" }
  | { status: "skipped"; reason: string }
  | { status: "unchanged" }
  | { status: "synced"; bucket: Bucket; created: boolean; events: string[] }

type StateRow = {
  email: string
  bucket: Bucket
  has_sent_offer: boolean
  ever_paid: boolean
  props_hash: string | null
}

async function resolveContact(admin: AdminClient, companyId: string, companyEmail: string | null) {
  const { data: users } = await admin
    .from("users")
    .select("full_name, email, role, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })

  const admins = (users ?? []).filter((u) => u.role === "admin" && u.email)
  const pick = admins[0] ?? (users ?? []).find((u) => u.email)
  if (pick?.email) return { email: (pick.email as string).toLowerCase(), firstName: firstNameOf(pick.full_name) }
  if (companyEmail) return { email: companyEmail.toLowerCase(), firstName: null }
  return null
}

async function offerStats(admin: AdminClient, companyId: string) {
  const { data } = await admin
    .from("offers")
    .select("amount_nok, status, sent_at")
    .eq("company_id", companyId)
    .not("sent_at", "is", null)
  const rows = data ?? []
  return {
    sentCount: rows.length,
    sentSumNok: Math.round(
      rows.filter((r) => r.status !== "rejected").reduce((sum, r) => sum + (Number(r.amount_nok) || 0), 0)
    ),
  }
}

function hashProps(firstName: string | null, props: ContactProperties): string {
  return createHash("sha1").update(JSON.stringify([firstName, props])).digest("hex")
}

/**
 * Synker én bedrift. Kaster ved feil — bruk scheduleResendSync fra produktkode.
 * `allowEvents: false` (backfill) oppdaterer kontakt og segmenter uten å starte automatiseringer.
 */
export async function syncCompanyToResend(
  companyId: string,
  opts: { allowEvents?: boolean; admin?: AdminClient } = {}
): Promise<SyncOutcome> {
  if (!isResendCrmEnabled()) return { status: "off" }
  const admin = opts.admin ?? createAdminClient()
  const allowEvents = opts.allowEvents ?? true

  const [{ data: company }, { data: billing }, { data: stateRow }] = await Promise.all([
    admin.from("companies").select("name, email, industry, created_at").eq("id", companyId).maybeSingle(),
    admin
      .from("company_billing")
      .select("status, plan_key, trial_ends_at, welcome_promo_code")
      .eq("company_id", companyId)
      .maybeSingle(),
    admin
      .from("resend_contact_sync")
      .select("email, bucket, has_sent_offer, ever_paid, props_hash")
      .eq("company_id", companyId)
      .maybeSingle(),
  ])

  if (!company) return { status: "skipped", reason: "company_missing" }
  const prevRow = (stateRow as StateRow | null) ?? null

  const status = (billing?.status as string | undefined) ?? null
  const everPaid = Boolean(prevRow?.ever_paid) || status === "active" || status === "past_due"
  const bucket = bucketFor(status, everPaid)
  if (!bucket) return { status: "skipped", reason: `status_${status ?? "none"}` }

  const contact = await resolveContact(admin, companyId, (company.email as string | null) ?? null)
  if (!contact) return { status: "skipped", reason: "no_contact" }

  const stats = await offerStats(admin, companyId)
  const promoCode =
    (billing?.welcome_promo_code as string | null) ??
    (bucket === "proeve" ? await ensureDiscountCode(companyId, (billing?.trial_ends_at as string | null) ?? null) : null)
  const next: SyncState = { bucket, hasSentOffer: stats.sentCount > 0, everPaid }
  const prev: SyncState | null = prevRow
    ? { bucket: prevRow.bucket, hasSentOffer: prevRow.has_sent_offer, everPaid: prevRow.ever_paid }
    : null

  const properties: ContactProperties = {
    firmanavn: prettyCompanyName(presentableCompanyName(company.name as string | null) ?? ""),
    fag: ((company.industry as string | null) ?? "").trim(),
    plan: (billing?.plan_key as string | null) ?? "",
    status: bucket,
    proeve_slutt: formatTrialEnd(billing?.trial_ends_at as string | null | undefined),
    antall_tilbud: stats.sentCount,
    sum_tilbud: stats.sentSumNok,
    rabattkode: promoCode ?? "",
  }
  const propsHash = hashProps(contact.firstName, properties)

  const emailChanged = Boolean(prevRow && prevRow.email !== contact.email)
  const bucketChanged = !prev || prev.bucket !== bucket || emailChanged
  const stateChanged =
    bucketChanged || prev?.hasSentOffer !== next.hasSentOffer || prev?.everPaid !== next.everPaid
  if (!stateChanged && prevRow?.props_hash === propsHash) return { status: "unchanged" }

  const segmentIds = await getSegmentIdsByName()
  const idOf = (name: string) => {
    const id = segmentIds.get(name)
    if (!id) throw new Error(`Segmentet «${name}» finnes ikke i Resend — kjør scripts/resend-crm-setup.mjs`)
    return id
  }

  // Ny e-postadresse: ta den gamle ut av alle våre segmenter, så kampanjer ikke går til feil person.
  if (emailChanged && prevRow) {
    for (const name of ALL_SEGMENTS) {
      await removeFromSegment(prevRow.email, idOf(name))
    }
  }

  const created = await upsertContact(
    { email: contact.email, firstName: contact.firstName, properties },
    segmentsFor(bucket).map(idOf)
  )

  if (!created && bucketChanged) {
    for (const name of segmentsFor(bucket)) await addToSegment(contact.email, idOf(name))
    for (const name of segmentsToLeave(bucket)) await removeFromSegment(contact.email, idOf(name))
  }

  const isFreshSignup =
    Boolean(company.created_at) && Date.now() - new Date(company.created_at as string).getTime() < FRESH_SIGNUP_MS
  const events = allowEvents ? eventsForTransition(prev, next, { isFreshSignup }) : []
  for (const event of events) {
    await sendEvent(event, contact.email, {
      fornavn: contact.firstName ?? "",
      firmanavn: properties.firmanavn,
      plan: properties.plan,
      antall_tilbud: stats.sentCount,
    })
  }

  const { error } = await admin.from("resend_contact_sync").upsert(
    {
      company_id: companyId,
      email: contact.email,
      bucket,
      has_sent_offer: next.hasSentOffer,
      ever_paid: everPaid,
      props_hash: propsHash,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  )
  if (error) throw new Error(`Kunne ikke lagre Resend-synkstatus: ${error.message}`)

  return { status: "synced", bucket, created, events }
}

/**
 * Synk etter at svaret er sendt. Trygg å kalle fra hvor som helst i
 * produktkoden: gjør ingenting når RESEND_CRM er av, og kaster aldri.
 */
export function scheduleResendSync(companyId: string | null | undefined) {
  if (!companyId || !isResendCrmEnabled()) return
  const run = async () => {
    try {
      await syncCompanyToResend(companyId)
    } catch (error) {
      await logServerError({
        message: "Resend-synk feilet for bedrift",
        error,
        level: "warning",
        source: "server",
        route: "scheduleResendSync",
        companyId,
      })
    }
  }
  try {
    after(run)
  } catch {
    // Utenfor en request (script/test) — kjør direkte.
    void run()
  }
}

export type SyncAllResult = {
  considered: number
  synced: number
  unchanged: number
  skipped: number
  failed: number
  events: number
}

/** Daglig sikkerhetsnett / backfill. `allowEvents: false` for første gangs import. */
export async function syncAllCompaniesToResend(opts: { allowEvents: boolean; limit?: number }): Promise<SyncAllResult> {
  const result: SyncAllResult = { considered: 0, synced: 0, unchanged: 0, skipped: 0, failed: 0, events: 0 }
  if (!isResendCrmEnabled()) return result

  const admin = createAdminClient()
  const { data: rows, error } = await admin.from("company_billing").select("company_id").limit(opts.limit ?? 2000)
  if (error) throw new Error(`Kunne ikke hente bedrifter: ${error.message}`)

  for (const row of rows ?? []) {
    result.considered += 1
    try {
      const outcome = await syncCompanyToResend(row.company_id as string, { allowEvents: opts.allowEvents, admin })
      if (outcome.status === "synced") {
        result.synced += 1
        result.events += outcome.events.length
      } else if (outcome.status === "unchanged") {
        result.unchanged += 1
      } else {
        result.skipped += 1
      }
    } catch (err) {
      result.failed += 1
      void logServerError({
        message: "Resend-synk (cron) feilet for bedrift",
        error: err,
        level: "warning",
        source: "worker",
        route: "syncAllCompaniesToResend",
        companyId: row.company_id as string,
      })
    }
  }
  return result
}
