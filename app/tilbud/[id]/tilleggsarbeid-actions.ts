"use server"

import { revalidatePath } from "next/cache"
import { Resend } from "resend"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import { escapeHtml } from "@/lib/outreach/templates"
import {
  buildPublicChangeOrderUrl,
  ensureChangeOrderPublicSlug,
  type ChangeOrder,
} from "@/lib/tilleggsarbeid/change-order"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

type OfferContext = {
  id: string
  company_id: string
  project_id: string | null
  customer_id: string | null
  recipient_email: string | null
  recipient_name: string | null
  customers?: { email: string | null; name: string | null } | { email: string | null; name: string | null }[] | null
}

async function resolveOfferCompany(supabase: Awaited<ReturnType<typeof createClient>>, offerId: string) {
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

  const { data: offer } = await supabase
    .from("offers")
    .select("id, company_id, project_id, customer_id, recipient_email, recipient_name, customers(email, name)")
    .eq("id", offerId)
    .eq("company_id", profile.company_id)
    .maybeSingle()
  if (!offer) throw new Error("Ugyldig tilbud")

  return {
    userId: user.id,
    companyId: profile.company_id as string,
    role: profile.role as string,
    offer: offer as OfferContext,
  }
}

export async function listChangeOrdersAction(offerId: string): Promise<ChangeOrder[]> {
  const supabase = await createClient()
  const { companyId } = await resolveOfferCompany(supabase, offerId)
  const { data } = await supabase
    .from("change_orders")
    .select("id, offer_id, title, description, amount_nok, status, public_slug, sent_at, customer_responded_at, created_at")
    .eq("company_id", companyId)
    .eq("offer_id", offerId)
    .order("created_at", { ascending: false })
  return (data ?? []) as ChangeOrder[]
}

export async function createChangeOrderAction(input: {
  offerId: string
  title: string
  description?: string
  amountNok: number
}) {
  const supabase = await createClient()
  const { userId, companyId, role, offer } = await resolveOfferCompany(supabase, input.offerId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const title = input.title?.trim()
  if (!title) throw new Error("Tittel mangler")
  const amount = Number(input.amountNok)
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Ugyldig beløp")

  const { error } = await supabase.from("change_orders").insert({
    company_id: companyId,
    offer_id: input.offerId,
    project_id: offer.project_id,
    customer_id: offer.customer_id,
    title,
    description: input.description?.trim() || null,
    amount_nok: amount,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/tilbud/${input.offerId}`)
}

export async function deleteChangeOrderAction(input: { offerId: string; id: string }) {
  const supabase = await createClient()
  const { companyId, role } = await resolveOfferCompany(supabase, input.offerId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const { error } = await supabase
    .from("change_orders")
    .delete()
    .eq("id", input.id)
    .eq("company_id", companyId)
    .eq("offer_id", input.offerId)
  if (error) throw new Error(error.message)
  revalidatePath(`/tilbud/${input.offerId}`)
}

export async function sendChangeOrderAction(input: { offerId: string; id: string }) {
  const supabase = await createClient()
  const { companyId, role, offer } = await resolveOfferCompany(supabase, input.offerId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const { data: co } = await supabase
    .from("change_orders")
    .select("id, title, amount_nok")
    .eq("id", input.id)
    .eq("company_id", companyId)
    .maybeSingle()
  if (!co) throw new Error("Tillegget finnes ikke")

  const customer = Array.isArray(offer.customers) ? offer.customers[0] : offer.customers
  const recipientEmail = String(offer.recipient_email || customer?.email || "").trim()
  if (!recipientEmail) throw new Error("Mangler kundens e-post på tilbudet")

  const slug = await ensureChangeOrderPublicSlug(input.id, companyId)
  const url = buildPublicChangeOrderUrl(slug)

  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle()
  const companyName = company?.name || "Proanbud"
  const amountFmt = new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK" }).format(Number(co.amount_nok))

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1c1917;line-height:1.6;">
    <p>Hei,</p>
    <p>${escapeHtml(companyName)} har sendt deg et tilleggsarbeid til godkjenning:</p>
    <p style="font-size:16px;margin:16px 0;"><strong>${escapeHtml(String(co.title))}</strong><br/>Beløp: ${amountFmt} (eks. mva)</p>
    <p style="margin:22px 0;"><a href="${url}" style="background:#1c1917;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;display:inline-block;">Se og godkjenn</a></p>
    <p style="font-size:12px;color:#78716c;">Eller åpne lenken: ${url}</p>
  </div>`

  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
    to: recipientEmail,
    subject: `Tilleggsarbeid fra ${companyName}`,
    html,
  })
  if (sendError) throw new Error(`Kunne ikke sende e-post: ${sendError.message ?? JSON.stringify(sendError)}`)

  await supabase
    .from("change_orders")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("company_id", companyId)
  revalidatePath(`/tilbud/${input.offerId}`)
  return { url }
}
