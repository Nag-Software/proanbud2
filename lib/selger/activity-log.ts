import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"

type LogSellerActivityInput = {
  // Nullable: automated jobs (e.g. the outreach cron) have no logged-in seller.
  sellerUserId: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
}

export async function logSellerActivity(input: LogSellerActivityInput) {
  const admin = createAdminClient()

  const { error } = await admin.from("seller_activity_log").insert({
    seller_user_id: input.sellerUserId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
  })

  if (error) {
    console.error("logSellerActivity", error)
    await logServerError({
      message: "Kunne ikke skrive seller_activity_log",
      error,
      level: "warning",
      source: "server",
      route: "logSellerActivity",
      context: { sellerUserId: input.sellerUserId, action: input.action, targetId: input.targetId },
    })
  }
}

type LogSellerEmailInput = {
  // Nullable: automated senders (e.g. trial reminders) have no logged-in seller.
  sentBy: string | null
  templateId: string
  recipientEmail: string
  companyId?: string | null
  // Resend message id — lets the webhook stamp delivery/open/click engagement.
  providerMessageId?: string | null
  // Kobler e-posten til leadets tidslinje + lagrer innholdet (db/66).
  prospectId?: string | null
  subject?: string | null
  body?: string | null
}

export async function logSellerEmail(input: LogSellerEmailInput) {
  const admin = createAdminClient()

  const { error } = await admin.from("seller_email_log").insert({
    sent_by: input.sentBy,
    template_id: input.templateId,
    recipient_email: input.recipientEmail.trim().toLowerCase(),
    company_id: input.companyId ?? null,
    provider_message_id: input.providerMessageId ?? null,
    prospect_id: input.prospectId ?? null,
    subject: input.subject ?? null,
    body: input.body ?? null,
  })

  if (error) {
    console.error("logSellerEmail", error)
    await logServerError({
      message: "Kunne ikke skrive seller_email_log",
      error,
      level: "warning",
      source: "server",
      route: "logSellerEmail",
      context: { sentBy: input.sentBy, templateId: input.templateId, companyId: input.companyId },
    })
  }
}
