import { createHash } from "node:crypto"
import { Resend } from "resend"

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  ACCEPT_CODE_MAX_ATTEMPTS,
  ACCEPT_CODE_RESEND_COOLDOWN_MS,
  ACCEPT_CODE_TTL_MS,
  generateAcceptCode,
  hashAcceptCode,
  maskEmail,
} from "@/lib/tilbud/accept-offer.shared"
import { buildCustomerEmailHtml } from "@/lib/tilbud/customer-emails"
import { buildPublicChangeOrderUrl, type PublicChangeOrder } from "@/lib/tilleggsarbeid/change-order"

/**
 * Kundegodkjenning av tilleggsarbeid – samme mønster som tilbudsaksept
 * (lib/tilbud/accept-offer.ts): engangskode på e-post, navn, og et bevis med
 * SHA-256 av nøyaktig det kunden godkjente.
 */

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")
const FROM_ADDRESS = () => process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>"
const VAT_RATE = 0.25

export type ChangeOrderDocument = {
  id: string
  title: string
  description: string | null
  amountNok: number
  billingType: string
  hourlyRateNok: number | null
  estimatedHours: number | null
}

/** SHA-256 av nøyaktig det kunden godkjente. Fast nøkkelrekkefølge gir samme hash hver gang. */
export function hashChangeOrderDocument(document: ChangeOrderDocument) {
  const canonical = {
    id: document.id,
    title: document.title,
    description: document.description ?? null,
    amountNok: Number(document.amountNok),
    billingType: document.billingType,
    hourlyRateNok: document.hourlyRateNok ?? null,
    estimatedHours: document.estimatedHours ?? null,
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

function formatAmountForCustomer(amountNok: number, pricesInclVat: boolean) {
  const amount = pricesInclVat ? amountNok * (1 + VAT_RATE) : amountNok
  const formatted = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(amount)
  return `${formatted} ${pricesInclVat ? "inkl. mva" : "eks. mva"}`
}

/**
 * E-post til kunden med lenke til godkjenning. Brukes både første gang og som påminnelse.
 */
export async function sendChangeOrderApprovalEmail(input: {
  record: PublicChangeOrder
  recipientEmail: string
  reminder: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { record } = input
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS(),
    to: input.recipientEmail,
    subject: input.reminder
      ? `Påminnelse: tilleggsarbeid venter på svar – ${record.title}`
      : `Tilleggsarbeid til godkjenning fra ${record.companyName}`,
    html: buildCustomerEmailHtml({
      recipientName: record.customerName || "der",
      companyName: record.companyName,
      intro: input.reminder
        ? `${record.companyName} venter på svaret ditt om tilleggsarbeidet under. Arbeidet utføres ikke før du har godkjent det.`
        : `${record.companyName} ber deg godkjenne et tilleggsarbeid som ikke var med i det opprinnelige tilbudet. Arbeidet utføres ikke før du har godkjent det.`,
      ctaLabel: "Se og svar",
      ctaUrl: buildPublicChangeOrderUrl(record.publicSlug),
      detailRows: [
        { label: "Arbeid", value: record.title },
        { label: "Pris", value: formatAmountForCustomer(record.amountNok, record.pricesInclVat) },
      ],
    }),
  })

  if (error) {
    await logServerError({
      message: "Kunne ikke sende tilleggsarbeid til godkjenning",
      error,
      source: "server",
      route: "sendChangeOrderApprovalEmail",
      companyId: record.companyId,
      context: { changeOrderId: record.id, reminder: input.reminder },
    })
    return { ok: false, error: "Kunne ikke sende e-posten. Sjekk adressen og prøv igjen." }
  }
  return { ok: true }
}

type RequestCodeResult =
  | { ok: true; maskedEmail: string }
  | { ok: false; error: "cooldown"; retryInSeconds: number }
  | { ok: false; error: "missing_email" | "not_respondable" | "server_error" }

/** Engangskoden sendes BARE til e-posten ekstrajobben gikk til – det beviser hvem som godkjente. */
export async function requestChangeOrderAcceptCode(record: PublicChangeOrder): Promise<RequestCodeResult> {
  if (!record.canRespond) return { ok: false, error: "not_respondable" }
  if (!record.recipientEmail) return { ok: false, error: "missing_email" }

  const admin = createAdminClient()
  const { data: state } = await admin.from("change_orders").select("accept_code_sent_at").eq("id", record.id).maybeSingle()

  const sentAt = (state as { accept_code_sent_at?: string | null } | null)?.accept_code_sent_at
  if (sentAt) {
    const elapsed = Date.now() - new Date(sentAt).getTime()
    if (elapsed >= 0 && elapsed < ACCEPT_CODE_RESEND_COOLDOWN_MS) {
      return { ok: false, error: "cooldown", retryInSeconds: Math.ceil((ACCEPT_CODE_RESEND_COOLDOWN_MS - elapsed) / 1000) }
    }
  }

  const code = generateAcceptCode()
  const now = new Date()
  const { data: updated, error: updateError } = await admin
    .from("change_orders")
    .update({
      accept_code_hash: hashAcceptCode(record.id, code),
      accept_code_expires_at: new Date(now.getTime() + ACCEPT_CODE_TTL_MS).toISOString(),
      accept_code_sent_at: now.toISOString(),
      accept_code_attempts: 0,
    })
    .eq("id", record.id)
    .eq("status", "sent")
    .select("id")

  if (updateError) {
    await logServerError({
      message: "Kunne ikke lagre engangskode for tilleggsarbeid",
      error: updateError,
      source: "server",
      route: "requestChangeOrderAcceptCode",
      companyId: record.companyId,
      context: { changeOrderId: record.id },
    })
    return { ok: false, error: "server_error" }
  }
  if (!updated?.length) return { ok: false, error: "not_respondable" }

  const { error: sendError } = await resend.emails.send({
    from: FROM_ADDRESS(),
    to: record.recipientEmail,
    subject: `Engangskode for å godkjenne tilleggsarbeid fra ${record.companyName}`,
    html: buildCustomerEmailHtml({
      recipientName: record.customerName || "der",
      companyName: record.companyName,
      intro: `Engangskoden din er ${code}. Den er gyldig i 10 minutter. Ved å taste koden godkjenner du tilleggsarbeidet «${record.title}» og prisen for det.`,
      ctaLabel: "Tilbake til tilleggsarbeidet",
      ctaUrl: buildPublicChangeOrderUrl(record.publicSlug),
      secondaryText: "Har du ikke bedt om denne koden, kan du se bort fra e-posten.",
    }),
  })

  if (sendError) {
    await logServerError({
      message: "Kunne ikke sende engangskode for tilleggsarbeid",
      error: sendError,
      source: "server",
      route: "requestChangeOrderAcceptCode",
      companyId: record.companyId,
      context: { changeOrderId: record.id },
    })
    return { ok: false, error: "server_error" }
  }

  return { ok: true, maskedEmail: maskEmail(record.recipientEmail) }
}

export type AcceptChangeOrderResult =
  | { ok: true; alreadyResponded?: boolean }
  | {
      ok: false
      error: "no_code" | "expired" | "wrong_code" | "too_many_attempts" | "not_respondable" | "server_error"
      attemptsLeft?: number
    }

export async function acceptChangeOrderWithCode(input: {
  record: PublicChangeOrder
  name: string
  code: string
  ip?: string | null
  userAgent?: string | null
}): Promise<AcceptChangeOrderResult> {
  const { record } = input
  const admin = createAdminClient()

  const { data: state, error: stateError } = await admin
    .from("change_orders")
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
    await admin.from("change_orders").update({ accept_code_attempts: nextAttempts }).eq("id", record.id)
    if (nextAttempts >= ACCEPT_CODE_MAX_ATTEMPTS) return { ok: false, error: "too_many_attempts" }
    return { ok: false, error: "wrong_code", attemptsLeft: ACCEPT_CODE_MAX_ATTEMPTS - nextAttempts }
  }

  const acceptedAt = new Date().toISOString()
  const documentSha256 = hashChangeOrderDocument({
    id: record.id,
    title: record.title,
    description: record.description,
    amountNok: record.amountNok,
    billingType: record.billingType,
    hourlyRateNok: record.hourlyRateNok,
    estimatedHours: record.estimatedHours,
  })

  // Sikret på status='sent', så dobbelttrykk bare godkjenner én gang.
  const { data: updated, error: updateError } = await admin
    .from("change_orders")
    .update({
      status: "accepted",
      approval_basis: "customer_otp",
      customer_responded_at: acceptedAt,
      updated_at: acceptedAt,
      accepted_by_name: input.name.trim(),
      accepted_email: record.recipientEmail,
      accepted_ip: input.ip || null,
      accepted_user_agent: input.userAgent?.slice(0, 512) || null,
      accepted_document_sha256: documentSha256,
      accept_code_hash: null,
      accept_code_expires_at: null,
      accept_code_attempts: 0,
    })
    .eq("id", record.id)
    .eq("status", "sent")
    .select("id")

  if (updateError) {
    await logServerError({
      message: "Kunne ikke lagre godkjenning av tilleggsarbeid",
      error: updateError,
      source: "server",
      route: "acceptChangeOrderWithCode",
      companyId: record.companyId,
      context: { changeOrderId: record.id },
    })
    return { ok: false, error: "server_error" }
  }
  if (!updated?.length) return { ok: true, alreadyResponded: true }

  // Kvittering til kunden. Godkjenningen er lagret – en feilet e-post skal ikke velte svaret.
  try {
    await resend.emails.send({
      from: FROM_ADDRESS(),
      to: record.recipientEmail,
      subject: `Bekreftelse: tilleggsarbeid godkjent – ${record.title}`,
      html: buildCustomerEmailHtml({
        recipientName: input.name.trim(),
        companyName: record.companyName,
        intro: `Du har godkjent tilleggsarbeidet under fra ${record.companyName}. Denne e-posten er din bekreftelse.`,
        ctaLabel: "Se tilleggsarbeidet",
        ctaUrl: buildPublicChangeOrderUrl(record.publicSlug),
        detailRows: [
          { label: "Arbeid", value: record.title },
          { label: "Pris", value: formatAmountForCustomer(record.amountNok, record.pricesInclVat) },
          { label: "Godkjent av", value: input.name.trim() },
          { label: "Dokument-ID", value: documentSha256.slice(0, 16).toUpperCase() },
        ],
      }),
    })
  } catch (error) {
    await logServerError({
      message: "Kvittering for godkjent tilleggsarbeid feilet",
      error,
      source: "server",
      route: "acceptChangeOrderWithCode",
      level: "warning",
      companyId: record.companyId,
      context: { changeOrderId: record.id },
    })
  }

  return { ok: true }
}

export async function rejectChangeOrder(record: PublicChangeOrder): Promise<{ ok: true; alreadyResponded?: boolean } | { ok: false }> {
  const admin = createAdminClient()
  const respondedAt = new Date().toISOString()
  const { data: updated, error } = await admin
    .from("change_orders")
    .update({ status: "rejected", customer_responded_at: respondedAt, updated_at: respondedAt })
    .eq("id", record.id)
    .eq("status", "sent")
    .select("id")
  if (error) return { ok: false }
  return { ok: true, alreadyResponded: !updated?.length }
}
