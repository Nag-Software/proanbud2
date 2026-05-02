import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  return { supabase, companyId: userRow.company_id }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params

  const { data: offer } = await ctx.supabase
    .from("offers")
    .select("id, customer_id, project_id")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  if (!offer.customer_id || !offer.project_id) {
    return NextResponse.json(
      { error: "Tilbud må være koblet til både kunde og prosjekt før Tripletex-synk." },
      { status: 400 }
    )
  }

  const nonce = Date.now()

  await enqueueIntegrationJob({
    companyId: ctx.companyId,
    jobType: "customer.upsert",
    payload: { customerId: offer.customer_id },
    idempotencyKey: `offer:${offer.id}:customer:${offer.customer_id}:${nonce}`,
  })

  await enqueueIntegrationJob({
    companyId: ctx.companyId,
    jobType: "project.upsert",
    payload: { projectId: offer.project_id },
    idempotencyKey: `offer:${offer.id}:project:${offer.project_id}:${nonce}`,
  })

  await enqueueIntegrationJob({
    companyId: ctx.companyId,
    jobType: "order.create_from_offer",
    payload: { offerId: offer.id, customerId: offer.customer_id, projectId: offer.project_id },
    idempotencyKey: `offer:${offer.id}:order:${nonce}`,
  })

  return NextResponse.json({ ok: true })
}
