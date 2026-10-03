import type { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"

export const COMPANY_NOTIFICATION = {
  OFFER_VIEWED: "offer_viewed",
  OFFER_EMAIL_BOUNCED: "offer_email_bounced",
} as const

export type CompanyNotificationKind = (typeof COMPANY_NOTIFICATION)[keyof typeof COMPANY_NOTIFICATION]

type CreateCompanyNotificationInput = {
  companyId: string
  kind: CompanyNotificationKind
  title: string
  body?: string | null
  /** Intern sti varselet åpner, f.eks. /tilbud/<id>. */
  href?: string | null
  offerId?: string | null
}

/**
 * Legger et varsel i firmaets bjelle (db/109). Kalles fra offentlige ruter og
 * webhooks, så den tar service-role-klienten og kaster aldri: et varsel som
 * ikke ble lagret skal ikke velte kundens side eller få Resend til å prøve
 * hendelsen på nytt.
 */
export async function createCompanyNotification(
  admin: ReturnType<typeof createAdminClient>,
  input: CreateCompanyNotificationInput
): Promise<void> {
  try {
    const { error } = await admin.from("company_notifications").insert({
      company_id: input.companyId,
      kind: input.kind,
      title: input.title,
      body: input.body || null,
      href: input.href || null,
      offer_id: input.offerId || null,
    })
    if (error) throw error
  } catch (error) {
    await logServerError({
      message: "Kunne ikke lagre varsel til firmaet",
      error,
      source: "server",
      route: "createCompanyNotification",
      level: "warning",
      companyId: input.companyId,
      context: { kind: input.kind, offerId: input.offerId ?? null },
    })
  }
}
