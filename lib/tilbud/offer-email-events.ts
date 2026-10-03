import type { createAdminClient } from "@/lib/supabase/admin"
import { COMPANY_NOTIFICATION, createCompanyNotification } from "@/lib/notifications/company-notifications"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { classifyOfferEmailEvent, shouldRetryUnmatchedOfferEvent } from "@/lib/tilbud/offer-tracking.shared"

/** Delen av Resend-hendelsen tilbudssporingen leser. */
export type OfferEmailEvent = {
  type?: string
  data?: {
    email_id?: string
    id?: string
    /** Når e-posten ble opprettet hos Resend. */
    created_at?: string
    to?: string[] | string
    tags?: Record<string, string> | Array<{ name?: string; value?: string }>
    bounce?: { type?: string; subType?: string; message?: string }
    failed?: { reason?: string }
    suppressed?: { type?: string; message?: string }
  }
}

/**
 * - handled:   hendelsen gjaldt et tilbud og er behandlet (eller allerede stemplet).
 * - retry:     gjelder et tilbud, men Resend-id-en er ikke lagret ennå — be Resend prøve igjen.
 * - not_offer: ikke en tilbuds-e-post, eller en hendelse vi ikke bryr oss om.
 */
export type OfferEmailEventResult = "handled" | "retry" | "not_offer"

function readOfferIdTag(tags: NonNullable<OfferEmailEvent["data"]>["tags"]): string | null {
  if (!tags) return null
  if (Array.isArray(tags)) {
    return tags.find((tag) => tag?.name === "offer_id")?.value ?? null
  }
  return tags.offer_id ?? null
}

function firstRecipient(to: string[] | string | undefined): string {
  const raw = Array.isArray(to) ? to[0] : to
  return (raw ?? "").trim()
}

/**
 * Stempler «levert» / «kom ikke frem» på tilbudet e-posten tilhører, logger det
 * under Hendelser og varsler firmaet når e-posten ikke kom frem.
 *
 * Kaster ved databasefeil — kalleren (webhooken) fanger og logger, slik at
 * outreach-flyten etterpå aldri stopper på grunn av tilbudssporingen.
 */
export async function handleOfferEmailEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: OfferEmailEvent
): Promise<OfferEmailEventResult> {
  const outcome = classifyOfferEmailEvent(event.type)
  const emailId = event.data?.email_id ?? event.data?.id ?? null
  if (!outcome || !emailId) return "not_offer"

  const { data: offer, error: lookupError } = await admin
    .from("offers")
    .select("id, company_id, title, recipient_email")
    .eq("email_provider_id", emailId)
    .maybeSingle()
  if (lookupError) throw lookupError

  if (!offer) {
    // Tilbuds-e-post (har offer_id-tag) vi ikke finner på Resend-id: enten
    // kom hendelsen før send-offer rakk å lagre id-en, eller så hører den til
    // en tidligere utsending. Bare den første er verdt et nytt forsøk.
    const isOfferEmail = Boolean(readOfferIdTag(event.data?.tags))
    if (isOfferEmail && shouldRetryUnmatchedOfferEvent({ emailCreatedAt: event.data?.created_at })) {
      return "retry"
    }
    return "not_offer"
  }

  const column = outcome === "delivered" ? "email_delivered_at" : "email_bounced_at"
  const { data: stamped, error: stampError } = await admin
    .from("offers")
    .update({ [column]: new Date().toISOString() })
    .eq("id", offer.id)
    .eq("email_provider_id", emailId)
    // Første hendelse vinner. Resend kan levere samme hendelse flere ganger.
    .is(column, null)
    .select("id")
  if (stampError) throw stampError
  if (!stamped || stamped.length === 0) return "handled"

  const offerId = String(offer.id)
  const companyId = String(offer.company_id)
  const recipient = String(offer.recipient_email || "").trim() || firstRecipient(event.data?.to)

  if (outcome === "delivered") {
    await logOfferActivity(
      {
        offerId,
        companyId,
        eventType: OFFER_ACTIVITY.EMAIL_DELIVERED,
        title: "E-posten er levert",
        description: recipient ? `Levert til ${recipient}` : null,
        metadata: { emailId },
      },
      { admin: true }
    )
    return "handled"
  }

  const reason =
    event.data?.bounce?.message || event.data?.failed?.reason || event.data?.suppressed?.message || null

  await logOfferActivity(
    {
      offerId,
      companyId,
      eventType: OFFER_ACTIVITY.EMAIL_BOUNCED,
      title: "E-posten kom ikke frem",
      description: recipient ? `Kunne ikke leveres til ${recipient}` : null,
      metadata: { emailId, resendEvent: event.type ?? null, reason },
    },
    { admin: true }
  )

  await createCompanyNotification(admin, {
    companyId,
    kind: COMPANY_NOTIFICATION.OFFER_EMAIL_BOUNCED,
    title: "Tilbudet kom ikke frem",
    body: [recipient, String(offer.title || "").trim()].filter(Boolean).join(" · "),
    href: `/tilbud/${offerId}`,
    offerId,
  })

  return "handled"
}
