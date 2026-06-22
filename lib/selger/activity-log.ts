import { createAdminClient } from "@/lib/supabase/admin"

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
  }
}

type LogSellerEmailInput = {
  // Nullable: the outreach cron sends with no logged-in seller.
  sentBy: string | null
  templateId: string
  recipientEmail: string
  companyId?: string | null
}

export async function logSellerEmail(input: LogSellerEmailInput) {
  const admin = createAdminClient()

  const { error } = await admin.from("seller_email_log").insert({
    sent_by: input.sentBy,
    template_id: input.templateId,
    recipient_email: input.recipientEmail.trim().toLowerCase(),
    company_id: input.companyId ?? null,
  })

  if (error) {
    console.error("logSellerEmail", error)
  }
}
