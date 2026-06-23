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

/** Check the opt-out list before sending (markedsføringsloven/GDPR). */
export async function isOptedOut(
  admin: AdminClient,
  args: { email: string | null; orgNumber: string | null }
): Promise<boolean> {
  const conditions: string[] = []
  if (args.email) conditions.push(`email.eq.${args.email}`)
  if (args.orgNumber) conditions.push(`org_number.eq.${args.orgNumber}`)
  if (conditions.length === 0) return false

  const { data } = await admin
    .from("outreach_unsubscribes")
    .select("id")
    .or(conditions.join(","))
    .maybeSingle()
  return Boolean(data)
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
    subject: args.subject,
    html,
    headers: { "List-Unsubscribe": `<${args.unsubscribeUrl}>` },
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
