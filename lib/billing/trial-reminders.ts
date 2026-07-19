// Automated trial-expiry email sequence.
//
// Trials convert when you remind people before they lapse. This finds companies in
// `trialing` status and emails the primary contact as the trial winds down:
//   • ~3 days left  → "prøveperioden utløper snart"
//   • ~1 day left   → "siste dag"
//   • just expired  → "slik beholder du tilgangen"
//
// Idempotent: each template is sent at most once per company. We check
// seller_email_log for an existing (company_id, template_id) row before sending,
// so re-running the daily job never double-mails anyone.

import { Resend } from "resend"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { TRIAL_TEMPLATES, type TrialTemplate } from "@/lib/billing/trial-reminder-templates"
import {
  applyWelcomeDiscountToSubscription,
  ensureWelcomeDiscount,
} from "@/lib/billing/welcome-discount"
import { logSellerEmail } from "@/lib/selger/activity-log"

type AdminClient = ReturnType<typeof createAdminClient>

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

/** Transactional sender — kept on the verified app domain, NOT the cold-outreach
 *  subdomain, so trial reminders never share reputation with cold email. */
function getTransactionalFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>"
}

const DAY_MS = 24 * 60 * 60 * 1000

export type TrialReminderResult = { considered: number; sent: number; skipped: number; failed: number }

type ContactInfo = { email: string; name: string }

/** Resolve the company's primary contact: prefer an admin user, else the earliest
 *  user, else the company's own email. */
async function resolveContact(
  admin: AdminClient,
  companyId: string,
  companyEmail: string | null
): Promise<ContactInfo | null> {
  const { data: users } = await admin
    .from("users")
    .select("full_name, email, role, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })

  const admins = (users ?? []).filter((u) => u.role === "admin" && u.email)
  const pick = admins[0] ?? (users ?? []).find((u) => u.email)
  if (pick?.email) {
    return { email: pick.email, name: pick.full_name || "der" }
  }
  if (companyEmail) return { email: companyEmail, name: "der" }
  return null
}

/** Which template (if any) is due for a trial ending at `trialEndsAt`, given how
 *  far away that is. Most-urgent-first. */
function pickTemplate(trialEndsAt: string): TrialTemplate | null {
  const diffMs = new Date(trialEndsAt).getTime() - Date.now()
  const daysLeft = Math.ceil(diffMs / DAY_MS)

  if (diffMs < 0) {
    // Expired — only nudge within the first 3 days after expiry.
    if (diffMs >= -3 * DAY_MS) return TRIAL_TEMPLATES.expired
    return null
  }
  if (daysLeft <= 1) return TRIAL_TEMPLATES.lastDay
  if (daysLeft <= 3) return TRIAL_TEMPLATES.soon
  return null
}

async function alreadySent(admin: AdminClient, companyId: string, templateId: string): Promise<boolean> {
  const { count } = await admin
    .from("seller_email_log")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("template_id", templateId)
  return (count ?? 0) > 0
}

export async function runTrialReminders(admin: AdminClient): Promise<TrialReminderResult> {
  const result: TrialReminderResult = { considered: 0, sent: 0, skipped: 0, failed: 0 }

  // Trialing companies whose trial ends within the next 4 days or expired in the last 3.
  const windowStart = new Date(Date.now() - 3 * DAY_MS).toISOString()
  const windowEnd = new Date(Date.now() + 4 * DAY_MS).toISOString()

  const { data: billing, error } = await admin
    .from("company_billing")
    .select("company_id, trial_ends_at, status")
    .eq("status", "trialing")
    .not("trial_ends_at", "is", null)
    .gte("trial_ends_at", windowStart)
    .lte("trial_ends_at", windowEnd)

  if (error) {
    console.error("[trial-reminders] load failed", error)
    throw new Error("Kunne ikke hente prøveperioder")
  }

  for (const row of billing ?? []) {
    result.considered += 1
    const template = pickTemplate(row.trial_ends_at as string)
    if (!template) {
      result.skipped += 1
      continue
    }

    try {
      if (await alreadySent(admin, row.company_id as string, template.id)) {
        result.skipped += 1
        continue
      }

      const { data: company } = await admin
        .from("companies")
        .select("name, email")
        .eq("id", row.company_id)
        .maybeSingle()

      const contact = await resolveContact(
        admin,
        row.company_id as string,
        (company?.email as string | null) ?? null
      )
      if (!contact) {
        result.skipped += 1
        continue
      }

      // Velkomstbonus: personlig 80 %-kode på første måned. Festes med én gang
      // på det (kortfrie) prøveabonnementet, slik at rabatten treffer første
      // faktura uten at brukeren må taste inn noe. Skal aldri blokkere
      // utsendingen — feiler den, går e-posten ut uten tilbudsboks.
      let promoCode: string | null = null
      try {
        const discount = await ensureWelcomeDiscount(row.company_id as string)
        if (discount) {
          promoCode = discount.code
          await applyWelcomeDiscountToSubscription(row.company_id as string, discount)
        }
      } catch (err) {
        console.error("[trial-reminders] velkomstrabatt feilet", row.company_id, err)
        void logServerError({
          message: "Velkomstrabatt kunne ikke opprettes/festes",
          error: err,
          level: "warning",
          source: "worker",
          route: "runTrialReminders",
          context: { companyId: row.company_id, templateId: template.id },
        })
      }

      const html = template.buildHtml({
        recipientName: contact.name,
        companyName: (company?.name as string | null) ?? null,
        promoCode,
      })

      const { data: sendData, error: sendError } = await resend.emails.send({
        from: getTransactionalFrom(),
        to: contact.email,
        subject: template.subject,
        html,
      })
      if (sendError) {
        console.error("[trial-reminders] send failed", row.company_id, sendError)
        void logServerError({
          message: "Trial-reminder: Resend-utsending feilet",
          error: sendError,
          level: "warning",
          source: "worker",
          route: "runTrialReminders",
          context: { companyId: row.company_id, templateId: template.id },
        })
        result.failed += 1
        continue
      }

      await logSellerEmail({
        sentBy: null,
        templateId: template.id,
        recipientEmail: contact.email,
        companyId: row.company_id as string,
        providerMessageId: sendData?.id ?? null,
      })
      result.sent += 1
    } catch (err) {
      console.error("[trial-reminders] failed for", row.company_id, err)
      void logServerError({
        message: "Trial-reminder e-post feilet for bedrift",
        error: err,
        level: "warning",
        source: "worker",
        route: "runTrialReminders",
        context: { companyId: row.company_id, templateId: template.id },
      })
      result.failed += 1
    }
  }

  return result
}
