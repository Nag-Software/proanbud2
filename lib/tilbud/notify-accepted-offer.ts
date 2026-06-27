import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase/admin"
import { escapeHtml } from "@/lib/outreach/templates"
import { logServerError } from "@/lib/errors/log"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

export async function notifyCompanyAdminsAboutAcceptedOffer(input: {
  companyId: string
  offerId: string
  offerTitle: string
  customerName: string
}) {
  const admin = createAdminClient()
  const { data: admins } = await admin
    .from("users")
    .select("id, email, full_name")
    .eq("company_id", input.companyId)
    .eq("role", "admin")

  const recipients = (admins || [])
    .map((row) => String(row.email || "").trim())
    .filter(Boolean)

  if (recipients.length === 0 || !process.env.RESEND_API_KEY) {
    return
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.proanbud.no"
  const offerUrl = `${appUrl}/tilbud/${input.offerId}`

  const { error } = await resend.emails
    .send({
      from: process.env.RESEND_FROM_EMAIL || "Proanbud <noreply@proanbud.no>",
      to: recipients,
      subject: `Kunde godtok tilbud: ${input.offerTitle}`,
      html: [
        `<p>Kunden <strong>${escapeHtml(input.customerName)}</strong> har godkjent tilbudet <strong>${escapeHtml(input.offerTitle)}</strong>.</p>`,
        `<p>Ordre opprettes i Tripletex.</p>`,
        `<p><a href="${offerUrl}">Åpne tilbud</a></p>`,
      ].join(""),
    })
    .catch((err) => ({ error: err }))
  if (error) {
    console.error("Failed to notify admins about accepted offer:", error)
    await logServerError({
      message: "Failed to notify admins about accepted offer",
      error,
      source: "server",
      route: "notifyCompanyAdminsAboutAcceptedOffer",
      level: "warning",
      context: { companyId: input.companyId, offerId: input.offerId },
    })
  }
}
