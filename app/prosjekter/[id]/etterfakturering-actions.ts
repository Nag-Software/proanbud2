"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import {
  ensureChangeOrderPublicSlug,
  fetchPublicChangeOrderBySlug,
  type ChangeOrder,
  type ChangeOrderBillingType,
} from "@/lib/tilleggsarbeid/change-order"
import { sendChangeOrderApprovalEmail } from "@/lib/tilleggsarbeid/approval"
import { isManualApprovalBasis, type ChangeOrderApprovalBasis } from "@/lib/tilleggsarbeid/approval.shared"
import { logServerError } from "@/lib/errors/log"

type ActionResult = { ok: true } | { ok: false; error: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ProjectContext = {
  id: string
  company_id: string
  customer_id: string | null
  customers?: { email: string | null; name: string | null } | { email: string | null; name: string | null }[] | null
}

async function resolveProjectCompany(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.company_id) throw new Error("Fant ikke bedrift")

  const { data: project } = await supabase
    .from("projects")
    .select("id, company_id, customer_id, customers(email, name)")
    .eq("id", projectId)
    .maybeSingle()
  if (!project || project.company_id !== profile.company_id) throw new Error("Ugyldig prosjekt")

  return {
    userId: user.id,
    companyId: profile.company_id as string,
    role: profile.role as string,
    project: project as ProjectContext,
  }
}

function parsePositiveAmount(value: number, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} må være et positivt tall`)
  return Math.round(parsed * 100) / 100
}

export async function listProjectChangeOrdersAction(projectId: string): Promise<ChangeOrder[]> {
  const supabase = await createClient()
  const { companyId } = await resolveProjectCompany(supabase, projectId)
  const { data } = await supabase
    .from("change_orders")
    // «*» tåler at kolonnene fra db/100 ikke finnes ennå.
    .select("*")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
  return (data ?? []) as ChangeOrder[]
}

export type ChangeOrderApprovalInput =
  | { mode: "send"; recipientEmail: string }
  | { mode: "agreed"; basis: Exclude<ChangeOrderApprovalBasis, "customer_otp">; note?: string }

/**
 * Oppretter en ekstrajobb og sørger for at kunden har samtykket: enten sendes den
 * til kunden for godkjenning, eller den registreres som allerede avtalt – med
 * grunnlaget (muntlig, skriftlig, hastearbeid) lagret.
 */
export async function createProjectChangeOrderAction(input: {
  projectId: string
  billingType: ChangeOrderBillingType
  title: string
  description?: string
  fixedPriceNok?: number | null
  hourlyRateNok?: number | null
  estimatedHours?: number | null
  approval: ChangeOrderApprovalInput
}): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { userId, companyId, role, project } = await resolveProjectCompany(supabase, input.projectId)
    if (!canManageProjects(role)) return { ok: false, error: "Du har ikke tilgang til å legge inn ekstrajobber." }

    const title = input.title?.trim()
    if (!title) return { ok: false, error: "Skriv hva ekstrajobben gjelder." }

    const billingType = input.billingType === "hourly" ? "hourly" : "fixed"
    const description = input.description?.trim() || null

    let amountNok = 0
    let hourlyRateNok: number | null = null
    let estimatedHours: number | null = null
    try {
      if (billingType === "hourly") {
        hourlyRateNok = parsePositiveAmount(input.hourlyRateNok ?? 0, "Timepris")
        estimatedHours = parsePositiveAmount(input.estimatedHours ?? 0, "Estimert antall timer")
        amountNok = parsePositiveAmount(hourlyRateNok * estimatedHours, "Beløp")
      } else {
        amountNok = parsePositiveAmount(input.fixedPriceNok ?? 0, "Fastpris")
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Sjekk beløpet." }
    }

    const approval = input.approval
    const recipientEmail = approval.mode === "send" ? approval.recipientEmail.trim() : null
    if (approval.mode === "send" && !EMAIL_PATTERN.test(recipientEmail ?? "")) {
      return { ok: false, error: "Skriv inn kundens e-postadresse, så kan de godkjenne." }
    }
    if (approval.mode === "agreed" && !isManualApprovalBasis(approval.basis)) {
      return { ok: false, error: "Velg hvordan ekstrajobben ble avtalt." }
    }

    const { data: created, error } = await supabase
      .from("change_orders")
      .insert({
        company_id: companyId,
        offer_id: null,
        project_id: input.projectId,
        // Kunden fra prosjektet: styrer bl.a. om prisen vises inkl. mva (privatkunde).
        customer_id: project.customer_id,
        title,
        description,
        amount_nok: amountNok,
        billing_type: billingType,
        hourly_rate_nok: hourlyRateNok,
        estimated_hours: estimatedHours,
        status: approval.mode === "agreed" ? "accepted" : "draft",
        ...(approval.mode === "agreed"
          ? {
              approval_basis: approval.basis,
              approval_note: approval.note?.trim() || null,
              customer_responded_at: new Date().toISOString(),
            }
          : { recipient_email: recipientEmail }),
        created_by: userId,
      })
      .select("id")
      .single()

    if (error || !created) {
      await logServerError({
        message: "Kunne ikke opprette ekstrajobb",
        error,
        source: "action",
        route: "createProjectChangeOrderAction",
        companyId,
        context: { projectId: input.projectId },
      })
      return {
        ok: false,
        error:
          error?.code === "42703"
            ? "Ekstrajobber med godkjenning krever en databaseoppdatering (db/100). Kontakt support."
            : "Kunne ikke lagre ekstrajobben. Prøv igjen.",
      }
    }

    revalidatePath(`/prosjekter/${input.projectId}`)
    if (approval.mode === "send") {
      return sendProjectChangeOrderAction({ projectId: input.projectId, id: created.id as string })
    }
    return { ok: true }
  } catch (error) {
    await logServerError({ message: "Uventet feil ved ny ekstrajobb", error, source: "action", route: "createProjectChangeOrderAction" })
    return { ok: false, error: "Noe gikk galt. Prøv igjen." }
  }
}

/**
 * Sender ekstrajobben til kunden for godkjenning – eller en påminnelse hvis den
 * allerede er sendt. Kunden godkjenner med navn og engangskode på e-post.
 */
export async function sendProjectChangeOrderAction(input: {
  projectId: string
  id: string
  recipientEmail?: string
}): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { companyId, role, project } = await resolveProjectCompany(supabase, input.projectId)
    if (!canManageProjects(role)) return { ok: false, error: "Du har ikke tilgang til å sende ekstrajobber." }

    const { data: row } = await supabase
      .from("change_orders")
      .select("*")
      .eq("id", input.id)
      .eq("company_id", companyId)
      .eq("project_id", input.projectId)
      .maybeSingle()
    if (!row) return { ok: false, error: "Fant ikke ekstrajobben." }

    const current = row as Record<string, unknown>
    const status = String(current.status)
    if (status !== "draft" && status !== "sent") {
      return { ok: false, error: "Ekstrajobben er allerede besvart." }
    }

    // Eldre rader har verken mottaker eller kunde lagret – da brukes prosjektkunden.
    const projectCustomer = Array.isArray(project.customers) ? project.customers[0] : project.customers
    const override =
      input.recipientEmail?.trim() ||
      (!current.recipient_email ? projectCustomer?.email?.trim() || undefined : undefined)
    if (override && !EMAIL_PATTERN.test(override)) return { ok: false, error: "E-postadressen ser ikke riktig ut." }

    const slug = await ensureChangeOrderPublicSlug(input.id, companyId)
    const now = new Date().toISOString()
    const reminder = status === "sent"
    const { error: updateError } = await supabase
      .from("change_orders")
      .update({
        status: "sent",
        ...(reminder ? { reminder_sent_at: now } : { sent_at: now }),
        ...(override ? { recipient_email: override } : {}),
        ...(!current.customer_id && project.customer_id ? { customer_id: project.customer_id } : {}),
        updated_at: now,
      })
      .eq("id", input.id)
      .eq("company_id", companyId)
    if (updateError) return { ok: false, error: "Kunne ikke oppdatere ekstrajobben. Prøv igjen." }

    const record = await fetchPublicChangeOrderBySlug(slug)
    if (!record) return { ok: false, error: "Fant ikke ekstrajobben." }
    if (!record.recipientEmail) {
      return { ok: false, error: "Kunden mangler e-postadresse. Legg den inn og prøv igjen." }
    }

    const sent = await sendChangeOrderApprovalEmail({ record, recipientEmail: record.recipientEmail, reminder })
    revalidatePath(`/prosjekter/${input.projectId}`)
    return sent
  } catch (error) {
    await logServerError({ message: "Uventet feil ved sending av ekstrajobb", error, source: "action", route: "sendProjectChangeOrderAction" })
    return { ok: false, error: "Noe gikk galt. Prøv igjen." }
  }
}

/** Kunden sa ja utenom lenken (muntlig, SMS, hastearbeid) – registreres med grunnlag. */
export async function markChangeOrderAgreedAction(input: {
  projectId: string
  id: string
  basis: Exclude<ChangeOrderApprovalBasis, "customer_otp">
  note?: string
}): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { companyId, role } = await resolveProjectCompany(supabase, input.projectId)
    if (!canManageProjects(role)) return { ok: false, error: "Du har ikke tilgang." }
    if (!isManualApprovalBasis(input.basis)) return { ok: false, error: "Velg hvordan ekstrajobben ble avtalt." }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from("change_orders")
      .update({
        status: "accepted",
        approval_basis: input.basis,
        approval_note: input.note?.trim() || null,
        customer_responded_at: now,
        updated_at: now,
      })
      .eq("id", input.id)
      .eq("company_id", companyId)
      .in("status", ["draft", "sent"])
      .select("id")
    if (error) return { ok: false, error: "Kunne ikke lagre. Prøv igjen." }
    if (!data?.length) return { ok: false, error: "Ekstrajobben er allerede besvart." }
    revalidatePath(`/prosjekter/${input.projectId}`)
    return { ok: true }
  } catch (error) {
    await logServerError({ message: "Uventet feil ved registrering av avtalt ekstrajobb", error, source: "action", route: "markChangeOrderAgreedAction" })
    return { ok: false, error: "Noe gikk galt. Prøv igjen." }
  }
}

export async function deleteProjectChangeOrderAction(input: { projectId: string; id: string }): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { companyId, role } = await resolveProjectCompany(supabase, input.projectId)
    if (!canManageProjects(role)) return { ok: false, error: "Du har ikke tilgang." }

    // En fakturert ekstrajobb kan ikke slettes – fakturalinjen ville pekt på ingenting.
    const { data: invoiced } = await supabase
      .from("project_invoice_lines")
      .select("id, project_invoices!inner(status)")
      .eq("company_id", companyId)
      .eq("source_type", "change_order")
      .eq("source_id", input.id)
      .neq("project_invoices.status", "cancelled")
      .limit(1)
    if (invoiced?.length) {
      return { ok: false, error: "Ekstrajobben er fakturert. Kanseller fakturaen først hvis den skal slettes." }
    }

    const { error } = await supabase
      .from("change_orders")
      .delete()
      .eq("id", input.id)
      .eq("company_id", companyId)
      .eq("project_id", input.projectId)
    if (error) return { ok: false, error: "Kunne ikke slette. Prøv igjen." }
    revalidatePath(`/prosjekter/${input.projectId}`)
    return { ok: true }
  } catch (error) {
    await logServerError({ message: "Uventet feil ved sletting av ekstrajobb", error, source: "action", route: "deleteProjectChangeOrderAction" })
    return { ok: false, error: "Noe gikk galt. Prøv igjen." }
  }
}
