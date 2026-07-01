import { Resend } from "resend"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import {
  ACCEPT_CODE_MAX_ATTEMPTS,
  ACCEPT_CODE_RESEND_COOLDOWN_MS,
  ACCEPT_CODE_TTL_MS,
  buildAcceptanceSnapshot,
  generateAcceptCode,
  hashAcceptCode,
  hashAcceptanceSnapshot,
  maskEmail,
} from "@/lib/tilbud/accept-offer.shared"
import { buildCustomerEmailHtml } from "@/lib/tilbud/customer-emails"
import {
  formatDocumentCurrency,
  getOfferDocumentTotals,
  type OfferDocumentAcceptance,
} from "@/lib/tilbud/offer-document"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { handleOfferAccepted } from "@/lib/tilbud/on-offer-accepted"
import { buildPublicOfferUrl, type PublicOfferRecord } from "@/lib/tilbud/public-offer"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

export type OfferAcceptanceEvidence = OfferDocumentAcceptance

function formatAcceptTimestamp(iso: string) {
  const date = new Date(iso)
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date)
}

function resolveRecipientEmail(record: PublicOfferRecord) {
  return (record.recipientEmail || record.customer.email || "").trim()
}

type RequestCodeResult =
  | { ok: true; maskedEmail: string }
  | { ok: false; error: "cooldown"; retryInSeconds: number }
  | { ok: false; error: "missing_email" | "not_respondable" | "server_error" }

/**
 * Generate and e-mail a one-time acceptance code. The code goes ONLY to the
 * address the offer was sent to — proving the accepter controls that mailbox.
 */
export async function requestOfferAcceptCode(record: PublicOfferRecord): Promise<RequestCodeResult> {
  if (!record.canRespond) return { ok: false, error: "not_respondable" }

  const recipientEmail = resolveRecipientEmail(record)
  if (!recipientEmail) return { ok: false, error: "missing_email" }

  const admin = createAdminClient()

  const { data: state } = await admin
    .from("offers")
    .select("accept_code_sent_at")
    .eq("id", record.id)
    .maybeSingle()

  if (state?.accept_code_sent_at) {
    const elapsed = Date.now() - new Date(state.accept_code_sent_at).getTime()
    if (elapsed >= 0 && elapsed < ACCEPT_CODE_RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        error: "cooldown",
        retryInSeconds: Math.ceil((ACCEPT_CODE_RESEND_COOLDOWN_MS - elapsed) / 1000),
      }
    }
  }

  const code = generateAcceptCode()
  const now = new Date()

  const { data: updated, error: updateError } = await admin
    .from("offers")
    .update({
      accept_code_hash: hashAcceptCode(record.id, code),
      accept_code_expires_at: new Date(now.getTime() + ACCEPT_CODE_TTL_MS).toISOString(),
      accept_code_sent_at: now.toISOString(),
      accept_code_attempts: 0,
    })
    .eq("id", record.id)
    .eq("status", "sent")
    .select("id")

  if (updateError || !updated?.length) {
    if (updateError) {
      await logServerError({
        message: "Kunne ikke lagre engangskode for tilbudsaksept",
        error: updateError,
        source: "server",
        route: "requestOfferAcceptCode",
        companyId: record.companyId,
        context: { offerId: record.id },
      })
      return { ok: false, error: "server_error" }
    }
    return { ok: false, error: "not_respondable" }
  }

  const companyName = record.company.name || "bedriften"
  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
    to: recipientEmail,
    subject: `Engangskode for å godta tilbud ${record.offerReference}`,
    html: buildAcceptCodeEmailHtml({
      recipientName: record.recipientName,
      companyName,
      offerReference: record.offerReference,
      code,
    }),
  })

  if (sendError) {
    await logServerError({
      message: "Kunne ikke sende engangskode for tilbudsaksept",
      error: sendError,
      source: "server",
      route: "requestOfferAcceptCode",
      companyId: record.companyId,
      context: { offerId: record.id },
    })
    return { ok: false, error: "server_error" }
  }

  return { ok: true, maskedEmail: maskEmail(recipientEmail) }
}

function buildAcceptCodeEmailHtml(input: {
  recipientName: string
  companyName: string
  offerReference: string
  code: string
}) {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <p style="margin:0 0 8px;color:#111827;font-size:16px;">Hei ${escape(input.recipientName)},</p>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
          Bruk engangskoden under for å godta tilbud ${escape(input.offerReference)} fra ${escape(input.companyName)}.
          Koden er gyldig i 10 minutter.
        </p>
        <p style="margin:0 0 20px;text-align:center;">
          <span style="display:inline-block;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:12px 24px;font-size:28px;font-weight:700;letter-spacing:0.35em;color:#111827;">${escape(input.code)}</span>
        </p>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
          Ved å taste koden bekrefter du at tilbudet aksepteres og at bindende avtale inngås.
          Har du ikke bedt om denne koden, kan du se bort fra e-posten.
        </p>
      </div>
    </div>
  `
}

type AcceptResult =
  | { ok: true; acceptance: OfferAcceptanceEvidence; alreadyResponded?: false }
  | { ok: true; alreadyResponded: true }
  | {
      ok: false
      error: "no_code" | "expired" | "wrong_code" | "too_many_attempts" | "not_respondable" | "server_error"
      attemptsLeft?: number
    }

/**
 * Verify the one-time code and flip the offer to accepted with a full evidence
 * package: verified e-mail, name, IP/user agent, timestamp, and a frozen
 * snapshot of the document with its SHA-256 hash.
 */
export async function acceptOfferWithCode(input: {
  record: PublicOfferRecord
  name: string
  code: string
  ip?: string | null
  userAgent?: string | null
}): Promise<AcceptResult> {
  const { record } = input
  const admin = createAdminClient()

  const { data: state, error: stateError } = await admin
    .from("offers")
    .select("accept_code_hash, accept_code_expires_at, accept_code_attempts, status")
    .eq("id", record.id)
    .maybeSingle()

  if (stateError || !state) return { ok: false, error: "server_error" }
  if (state.status === "accepted") return { ok: true, alreadyResponded: true }
  if (state.status !== "sent") return { ok: false, error: "not_respondable" }
  if (!state.accept_code_hash) return { ok: false, error: "no_code" }

  const attempts = Number(state.accept_code_attempts || 0)
  if (attempts >= ACCEPT_CODE_MAX_ATTEMPTS) return { ok: false, error: "too_many_attempts" }

  if (!state.accept_code_expires_at || new Date(state.accept_code_expires_at).getTime() < Date.now()) {
    return { ok: false, error: "expired" }
  }

  if (hashAcceptCode(record.id, input.code) !== state.accept_code_hash) {
    const nextAttempts = attempts + 1
    await admin.from("offers").update({ accept_code_attempts: nextAttempts }).eq("id", record.id)
    if (nextAttempts >= ACCEPT_CODE_MAX_ATTEMPTS) {
      return { ok: false, error: "too_many_attempts" }
    }
    return { ok: false, error: "wrong_code", attemptsLeft: ACCEPT_CODE_MAX_ATTEMPTS - nextAttempts }
  }

  const acceptedEmail = resolveRecipientEmail(record)
  const acceptedAt = new Date().toISOString()
  const snapshot = buildAcceptanceSnapshot(record)
  const documentSha256 = hashAcceptanceSnapshot(snapshot)

  const acceptance: OfferAcceptanceEvidence = {
    name: input.name.trim(),
    email: acceptedEmail,
    acceptedAt,
    method: "email_otp",
    documentSha256,
  }

  // Guarded by status='sent' so a race/double submit can only accept once.
  const { data: updated, error: updateError } = await admin
    .from("offers")
    .update({
      status: "accepted",
      customer_responded_at: acceptedAt,
      updated_at: acceptedAt,
      accepted_at: acceptedAt,
      accepted_by_name: acceptance.name,
      accepted_email: acceptedEmail,
      accepted_ip: input.ip || null,
      accepted_user_agent: input.userAgent?.slice(0, 512) || null,
      accepted_method: "email_otp",
      accepted_document_sha256: documentSha256,
      accepted_snapshot: snapshot,
      accept_code_hash: null,
      accept_code_expires_at: null,
      accept_code_attempts: 0,
    })
    .eq("id", record.id)
    .eq("status", "sent")
    .select("id")

  if (updateError) {
    await logServerError({
      message: "Kunne ikke lagre aksept av tilbud",
      error: updateError,
      source: "server",
      route: "acceptOfferWithCode",
      companyId: record.companyId,
      context: { offerId: record.id },
    })
    return { ok: false, error: "server_error" }
  }
  if (!updated?.length) return { ok: true, alreadyResponded: true }

  await logOfferActivity(
    {
      offerId: record.id,
      companyId: record.companyId,
      eventType: OFFER_ACTIVITY.ACCEPTED,
      title: "Kunde godtok tilbudet",
      description: `${acceptance.name} — bekreftet med engangskode til ${maskEmail(acceptedEmail)}`,
      metadata: {
        publicSlug: record.publicSlug,
        acceptedByName: acceptance.name,
        acceptedEmail,
        acceptedMethod: "email_otp",
        documentSha256,
        ip: input.ip || null,
        userAgent: input.userAgent?.slice(0, 256) || null,
      },
    },
    { admin: true }
  )

  // Receipt to the customer. The acceptance is already recorded — a failed
  // e-mail must not fail the request.
  try {
    const companyName = record.company.name || "bedriften"
    const { totalInclVatNok } = getOfferDocumentTotals(record.lineItems)
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
      to: acceptedEmail,
      subject: `Avtalebekreftelse — tilbud ${record.offerReference} fra ${companyName}`,
      html: buildCustomerEmailHtml({
        recipientName: acceptance.name,
        companyName,
        intro: `Du har godtatt tilbudet fra ${companyName}. Bindende avtale er inngått, og denne e-posten er din bekreftelse. Avtaledokumentet kan lastes ned som PDF via lenken under.`,
        ctaLabel: "Se avtalen",
        ctaUrl: buildPublicOfferUrl(record.publicSlug),
        detailRows: [
          { label: "Tilbudsnr.", value: record.offerReference },
          { label: "Totalt inkl. mva", value: formatDocumentCurrency(totalInclVatNok) },
          { label: "Akseptert av", value: acceptance.name },
          { label: "Tidspunkt", value: formatAcceptTimestamp(acceptedAt) },
          { label: "Dokument-ID", value: documentSha256.slice(0, 16).toUpperCase() },
        ],
      }),
    })
  } catch (error) {
    await logServerError({
      message: "Avtalebekreftelse på e-post feilet etter aksept",
      error,
      source: "server",
      route: "acceptOfferWithCode",
      level: "warning",
      companyId: record.companyId,
      context: { offerId: record.id },
    })
  }

  // Project promotion + ERP sync + admin notifications (existing pipeline).
  void handleOfferAccepted({
    offerId: record.id,
    companyId: record.companyId,
    source: "public_accept",
  }).catch(async (error) => {
    await logServerError({
      message: "Etter-aksept-pipeline feilet (Tripletex/Fiken/varsling)",
      error,
      source: "server",
      route: "acceptOfferWithCode",
      level: "warning",
      companyId: record.companyId,
      context: { offerId: record.id },
    })
  })

  return { ok: true, acceptance }
}
