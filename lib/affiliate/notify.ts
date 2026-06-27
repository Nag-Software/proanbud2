import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

/** Where new seller applications are sent. Defaults to post@proanbud.no. */
function notifyTo(): string {
  return process.env.AFFILIATE_NOTIFY_EMAIL?.trim() || "post@proanbud.no"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export type AffiliateApplicationEmailInput = {
  contactName: string
  email: string
  phone?: string
  companyName?: string
  orgNr?: string
  channel?: string
  referralCode: string
}

export type NotifyResult = { sent: boolean; error?: string }

/**
 * Notify the team that a new seller (henvisningspartner) applied. Best-effort:
 * returns { sent:false } instead of throwing when RESEND_API_KEY is missing or
 * Resend rejects, so a failed e-mail never blocks storing the application.
 */
export async function sendAffiliateApplicationEmail(
  input: AffiliateApplicationEmailInput,
): Promise<NotifyResult> {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY not set" }
  }

  const rows: Array<[string, string]> = [
    ["Navn", input.contactName],
    ["E-post", input.email],
    ["Telefon", input.phone || "—"],
    ["Bedrift", input.companyName || "—"],
    ["Org.nr", input.orgNr || "—"],
    ["Henvisningskode", input.referralCode],
    ["Hvordan henvise", input.channel || "—"],
  ]

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(
          label,
        )}</td><td style="padding:6px 0;color:#111827">${escapeHtml(value)}</td></tr>`,
    )
    .join("")

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
      <h2 style="margin:0 0 4px;font-size:18px;color:#111827;">Ny selger-søknad</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">Sendt inn via /bli-selger. Behandle den i /sjefen/selgere.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">${tableRows}</table>
    </div>
  </div>`

  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n")

  try {
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
      to: notifyTo(),
      replyTo: input.email,
      subject: `Ny selger-søknad: ${input.contactName}${
        input.companyName ? ` (${input.companyName})` : ""
      }`,
      html,
      text,
    })
    if (error) {
      return { sent: false, error: error.message ?? JSON.stringify(error) }
    }
    return { sent: true }
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Ukjent e-postfeil",
    }
  }
}
