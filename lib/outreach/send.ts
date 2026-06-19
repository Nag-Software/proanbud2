import { Resend } from "resend"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildOutreachEmailHtml } from "@/lib/outreach/templates"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

type AdminClient = ReturnType<typeof createAdminClient>

/** Per the product decision, outreach is sent from post@proanbud.no. */
export function getOutreachFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>"
}

/** Signup/landing CTA the outreach invites recipients to. */
export function getOutreachSignupUrl(): string {
  return process.env.OUTREACH_SIGNUP_URL?.trim() || "https://nye.proanbud.no/signup?utm_source=outreach"
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
 *  sender identity and unsubscribe footer. */
export async function sendOutreachEmail(args: {
  to: string
  subject: string
  body: string
  unsubscribeUrl: string
}): Promise<void> {
  const html = buildOutreachEmailHtml({
    bodyText: args.body,
    unsubscribeUrl: args.unsubscribeUrl,
    ctaUrl: getOutreachSignupUrl(),
  })
  await resend.emails.send({
    from: getOutreachFromAddress(),
    to: args.to,
    subject: args.subject,
    html,
    headers: { "List-Unsubscribe": `<${args.unsubscribeUrl}>` },
  })
}
