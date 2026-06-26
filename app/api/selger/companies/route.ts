import { NextResponse } from "next/server"
import crypto from "crypto"
import { Resend } from "resend"

import { logSellerActivity, logSellerEmail } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { renderSellerEmailTemplate } from "@/lib/selger/email-templates"
import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { assignUserRole, ensureCompanyRoles } from "@/lib/company-roles"
import { ensureCompanyBillingRow } from "@/lib/billing/sync"
import { fetchSelgerCompaniesFiltered } from "@/lib/selger/queries"
import { createAdminClient } from "@/lib/supabase/admin"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

function generateTemporaryPassword() {
  return crypto.randomBytes(12).toString("base64url")
}

export async function GET(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const companies = await fetchSelgerCompaniesFiltered({
    q: searchParams.get("q") ?? undefined,
    plan: searchParams.get("plan") ?? undefined,
    billingStatus: searchParams.get("billing_status") ?? undefined,
    contactStatus: searchParams.get("contact_status") ?? undefined,
    createdFrom: searchParams.get("created_from") ?? undefined,
    createdTo: searchParams.get("created_to") ?? undefined,
  })

  return NextResponse.json({ companies })
}

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  try {
    const { name, org_number, full_name, email, send_welcome_email = true } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: "Bedriftsnavn mangler." }, { status: 400 })
    }

    if (!email?.trim()) {
      return NextResponse.json({ error: "E-post mangler." }, { status: 400 })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const admin = createAdminClient()

    const { data: existingUser } = await admin
      .from("users")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json({ error: "En bruker med denne e-posten finnes allerede." }, { status: 400 })
    }

    const temporaryPassword = generateTemporaryPassword()

    const { data: authRecord, error: authError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: full_name?.trim() || "Ny bruker" },
    })

    if (authError || !authRecord.user) {
      console.error("create company auth error:", authError)
      await logServerError({
        message: "Opprett firma: kunne ikke opprette auth-bruker",
        error: authError,
        source: "api",
        route: "/api/selger/companies",
        method: "POST",
        userId: auth.user?.id ?? null,
        context: { email: normalizedEmail },
      })
      return NextResponse.json(
        { error: "Kunne ikke opprette bruker: " + (authError?.message || "Ukjent feil") },
        { status: 500 }
      )
    }

    const { data: companyData, error: companyError } = await admin
      .from("companies")
      .insert({
        name: String(name).trim(),
        org_number: org_number?.trim() || null,
        email: normalizedEmail,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (companyError || !companyData) {
      await admin.auth.admin.deleteUser(authRecord.user.id)
      if (companyError?.code === "23505") {
        return NextResponse.json(
          { error: "En bedrift med dette organisasjonsnummeret eksisterer allerede." },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: "Kunne ikke opprette bedrift." }, { status: 500 })
    }

    const { error: userError } = await admin.from("users").upsert({
      id: authRecord.user.id,
      email: normalizedEmail,
      company_id: companyData.id,
      full_name: full_name?.trim() || "Ny bruker",
      role: "admin",
      is_active: true,
    })

    if (userError) {
      console.error("create company user error:", userError)
      await logServerError({
        message: "Opprett firma: kunne ikke knytte bruker til bedrift",
        error: userError,
        source: "api",
        route: "/api/selger/companies",
        method: "POST",
        userId: auth.user?.id ?? null,
        companyId: companyData.id,
        context: { email: normalizedEmail, newUserId: authRecord.user.id },
      })
      return NextResponse.json({ error: "Kunne ikke knytte bruker til bedrift." }, { status: 500 })
    }

    try {
      await ensureCompanyRoles(admin, companyData.id)
      await assignUserRole(admin, {
        userId: authRecord.user.id,
        companyId: companyData.id,
        roleName: "Administrator",
      })
    } catch (roleSetupError) {
      console.error("Role setup error:", roleSetupError)
      // Best-effort: company is created; roles can be repaired later. Surface for visibility.
      await logServerError({
        message: "Opprett firma: rolle-oppsett feilet",
        error: roleSetupError,
        level: "warning",
        source: "api",
        route: "/api/selger/companies",
        method: "POST",
        userId: auth.user?.id ?? null,
        companyId: companyData.id,
      })
    }

    try {
      await ensureCompanyBillingRow(companyData.id)
    } catch (billingSetupError) {
      console.error("Billing setup error:", billingSetupError)
      // Best-effort: billing row can be reconciled later. Surface for visibility.
      await logServerError({
        message: "Opprett firma: billing-oppsett feilet",
        error: billingSetupError,
        level: "warning",
        source: "api",
        route: "/api/selger/companies",
        method: "POST",
        userId: auth.user?.id ?? null,
        companyId: companyData.id,
      })
    }

    if (send_welcome_email) {
      const rendered = renderSellerEmailTemplate("velkommen", {
        recipientName: full_name?.trim() || "der",
        companyName: companyData.name,
        customMessage: `Du kan logge inn med e-posten ${normalizedEmail}. Vi anbefaler å tilbakestille passordet ved første innlogging.`,
      })

      if (rendered) {
        try {
          const { error: sendError } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
            to: normalizedEmail,
            subject: rendered.subject,
            html: rendered.html,
          })
          if (sendError) {
            throw new Error(sendError.message ?? JSON.stringify(sendError))
          }

          await logSellerEmail({
            sentBy: auth.user!.id,
            templateId: "velkommen",
            recipientEmail: normalizedEmail,
            companyId: companyData.id,
          })
        } catch (emailError) {
          console.error("Welcome email error:", emailError)
          // Best-effort: welcome email failing must not fail company creation.
          await logServerError({
            message: "Opprett firma: velkomst-e-post feilet",
            error: emailError,
            level: "warning",
            source: "api",
            route: "/api/selger/companies",
            method: "POST",
            userId: auth.user?.id ?? null,
            companyId: companyData.id,
            context: { recipientEmail: normalizedEmail },
          })
        }
      }
    }

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "create_company",
      targetType: "company",
      targetId: companyData.id,
      metadata: {
        companyName: companyData.name,
        email: normalizedEmail,
        sendWelcomeEmail: Boolean(send_welcome_email),
      },
    })

    return NextResponse.json(
      {
        success: true,
        companyId: companyData.id,
        userId: authRecord.user.id,
        email: normalizedEmail,
        temporaryPassword,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST /api/selger/companies", error)
    await logServerError({
      message: "POST /api/selger/companies feilet",
      error,
      source: "api",
      route: "/api/selger/companies",
      method: "POST",
      userId: auth.user?.id ?? null,
    })
    return NextResponse.json({ error: "Intern serverfeil" }, { status: 500 })
  }
}
