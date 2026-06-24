import { Resend } from "resend"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildOutreachEmailHtml } from "@/lib/outreach/templates"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Avsender for kald-outreach. Holdes adskilt fra transaksjonell e-post (tilbud,
 * varsler, invitasjoner) slik at bounces/spam-klager fra kald-utsending ikke
 * skader leveringsgraden på betalende kunders e-post.
 *
 * Sett OUTREACH_FROM_EMAIL til en adresse på et eget, separat verifisert
 * cold-subdomene (f.eks. "Proanbud <post@kontakt.proanbud.no>") ETTER at
 * subdomenet er satt opp i Resend med egen SPF/DKIM/DMARC. Inntil da faller den
 * trygt tilbake til den transaksjonelle avsenderen, så ingenting slutter å virke.
 */
export function getOutreachFromAddress(): string {
  return (
    process.env.OUTREACH_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Proanbud <post@proanbud.no>"
  )
}

/**
 * Reply-To for kald-outreach. E-posten sendes fra det isolerte cold-subdomenet
 * (egen leveringsreputasjon), men SVAR fra prospekter må havne i en overvåket
 * innboks på hoveddomenet — ellers forsvinner interesserte leads i et subdomene
 * ingen leser. Sett OUTREACH_REPLY_TO_EMAIL til en ekte innboks du følger med på
 * (f.eks. "casper@proanbud.no"). Faller trygt tilbake til transaksjonsavsenderen.
 */
export function getOutreachReplyToAddress(): string {
  return (
    process.env.OUTREACH_REPLY_TO_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Proanbud <post@proanbud.no>"
  )
}

/** Signup/landing CTA the outreach invites recipients to. */
export function getOutreachSignupUrl(): string {
  return process.env.OUTREACH_SIGNUP_URL?.trim() || "https://nye.proanbud.no/signup?utm_source=outreach"
}

/** Template ids logged to seller_email_log for outbound lead emails. Both the
 *  first cold email and follow-ups count toward the same daily cap so the engine
 *  never exceeds a safe sending volume regardless of how the run is triggered. */
export const OUTREACH_TEMPLATE_IDS = ["outreach-cold", "outreach-followup"] as const

/** Daily send cap protecting sender reputation (cold + follow-up combined). */
export function getOutreachDailyLimit(): number {
  return Number(process.env.OUTREACH_DAILY_LIMIT) || 200
}

/** How many outreach emails (cold + follow-up) have been sent so far today (UTC). */
export async function countOutreachSentToday(admin: AdminClient): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count } = await admin
    .from("seller_email_log")
    .select("id", { count: "exact", head: true })
    .in("template_id", OUTREACH_TEMPLATE_IDS as unknown as string[])
    .gte("created_at", startOfDay.toISOString())
  return count ?? 0
}

/** Check the opt-out list before sending (markedsføringsloven/GDPR). Emails are
 *  compared lowercased — the suppress list always stores them lowercased (see
 *  recordUnsubscribe), so a bounce/complaint recorded as "post@firma.no" still blocks
 *  a prospect stored as "Post@Firma.no". */
export async function isOptedOut(
  admin: AdminClient,
  args: { email: string | null; orgNumber: string | null }
): Promise<boolean> {
  const email = args.email?.trim().toLowerCase() || null
  const orgNumber = args.orgNumber?.trim() || null
  const conditions: string[] = []
  if (email) conditions.push(`email.eq.${email}`)
  if (orgNumber) conditions.push(`org_number.eq.${orgNumber}`)
  if (conditions.length === 0) return false

  // .limit(1) (not .maybeSingle) — a prospect can match more than one suppress row
  // (e.g. by email AND by org), and maybeSingle errors on >1 row, which would wrongly
  // read as "not opted out". We only care that at least one match exists.
  const { data } = await admin
    .from("outreach_unsubscribes")
    .select("id")
    .or(conditions.join(","))
    .limit(1)
  return Boolean(data && data.length > 0)
}

/**
 * Add an address/org to the outreach suppress list, de-duped, so isOptedOut() blocks
 * all future cold sends. Shared by the unsubscribe route and the Resend bounce/complaint
 * webhook.
 *
 * Emails are stored lowercased so suppression matches regardless of the casing the
 * prospect's address is stored in. When there's no email we can't lean on the
 * unique(email) index for idempotency — Postgres treats NULLs as distinct, so a plain
 * upsert would insert a fresh row on every call — so org-only opt-outs are guarded on
 * org_number instead.
 */
export async function recordUnsubscribe(
  admin: AdminClient,
  args: { email: string | null; orgNumber: string | null; reason: string }
): Promise<void> {
  const email = args.email?.trim().toLowerCase() || null
  const orgNumber = args.orgNumber?.trim() || null
  if (!email && !orgNumber) return

  if (email) {
    await admin
      .from("outreach_unsubscribes")
      .upsert(
        { email, org_number: orgNumber, reason: args.reason },
        { onConflict: "email", ignoreDuplicates: true }
      )
    return
  }

  const { data: existing } = await admin
    .from("outreach_unsubscribes")
    .select("id")
    .eq("org_number", orgNumber)
    .limit(1)
  if (existing && existing.length > 0) return
  await admin
    .from("outreach_unsubscribes")
    .insert({ email: null, org_number: orgNumber, reason: args.reason })
}

/** Render + send a single outreach email from post@proanbud.no with the CTA,
 *  sender identity and unsubscribe footer.
 *
 *  `ctaUrl`/`ctaLabel` override the default trial CTA — used to point the button
 *  at a trade-specific example offer ("slik ville ditt sett ut"). When omitted,
 *  it falls back to the signup CTA so nothing breaks. */
export async function sendOutreachEmail(args: {
  to: string
  subject: string
  body: string
  unsubscribeUrl: string
  ctaUrl?: string
  ctaLabel?: string
}): Promise<{ providerMessageId: string | null }> {
  const html = buildOutreachEmailHtml({
    bodyText: args.body,
    unsubscribeUrl: args.unsubscribeUrl,
    ctaUrl: args.ctaUrl || getOutreachSignupUrl(),
    ctaLabel: args.ctaLabel,
  })
  const { data, error } = await resend.emails.send({
    from: getOutreachFromAddress(),
    to: args.to,
    replyTo: getOutreachReplyToAddress(),
    subject: args.subject,
    html,
    headers: {
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      // RFC 8058 one-click unsubscribe — Gmail/Yahoo require this for bulk/cold
      // senders and POST the URL directly (handled by the route's POST export).
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  })
  // Resend kaster ikke ved API-feil — den returnerer { error }. Uten denne
  // sjekken loggføres feilede sendinger som "kontaktet" og prospektet brennes.
  if (error) {
    throw new Error(`Resend-utsending feilet: ${error.message ?? JSON.stringify(error)}`)
  }
  // The provider id lets the Resend webhook stamp delivery/open/click events back
  // onto seller_email_log so we can measure what's actually working.
  return { providerMessageId: data?.id ?? null }
}
