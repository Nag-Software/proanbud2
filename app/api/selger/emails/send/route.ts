import { NextResponse } from "next/server"
import { Resend } from "resend"

import { logSellerActivity, logSellerEmail } from "@/lib/selger/activity-log"
import { renderSellerEmailTemplate } from "@/lib/selger/email-templates"
import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  try {
    const {
      template_id,
      recipient_email,
      recipient_name,
      company_id,
      company_name,
      custom_message,
    } = await request.json()

    if (!template_id?.trim()) {
      return NextResponse.json({ error: "Mal mangler" }, { status: 400 })
    }

    if (!recipient_email?.trim()) {
      return NextResponse.json({ error: "Mottaker-e-post mangler" }, { status: 400 })
    }

    const normalizedEmail = String(recipient_email).trim().toLowerCase()
    const admin = createAdminClient()

    let resolvedCompanyName = company_name?.trim() || null

    if (company_id) {
      const { data: company } = await admin
        .from("companies")
        .select("name")
        .eq("id", company_id)
        .maybeSingle()

      if (company?.name) {
        resolvedCompanyName = company.name
      }
    }

    const rendered = renderSellerEmailTemplate(template_id, {
      recipientName: recipient_name?.trim() || "der",
      companyName: resolvedCompanyName,
      customMessage: custom_message,
    })

    if (!rendered) {
      return NextResponse.json({ error: "Ukjent e-postmal" }, { status: 400 })
    }

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
      to: normalizedEmail,
      subject: rendered.subject,
      html: rendered.html,
    })

    await logSellerEmail({
      sentBy: auth.user!.id,
      templateId: template_id,
      recipientEmail: normalizedEmail,
      companyId: company_id ?? null,
    })

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "send_email",
      targetType: "company",
      targetId: company_id ?? null,
      metadata: {
        templateId: template_id,
        recipientEmail: normalizedEmail,
        companyId: company_id ?? null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("POST /api/selger/emails/send", error)
    return NextResponse.json({ error: "Intern serverfeil" }, { status: 500 })
  }
}
