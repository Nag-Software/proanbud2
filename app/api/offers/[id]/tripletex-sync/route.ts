import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { companyHasFeature } from "@/lib/billing/server-modules"
import {
  enqueueOfferTripletexSyncAndProcess,
  fetchOfferTripletexSyncStatus,
} from "@/lib/integrations/tripletex/sync"

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  return { supabase, companyId: userRow.company_id, role: String(userRow.role || "") }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const status = await fetchOfferTripletexSyncStatus(
    ctx.companyId,
    offer.id,
    offer.customer_id,
    offer.project_id
  )

  return NextResponse.json({ ok: true, ...status })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  // Mutating: enqueues real order/invoice creation in Tripletex. Admins and managers may
  // trigger an offer sync (matches retry-failed/route.ts); the integrasjoner plan must be
  // active. Note: the connection-management route (integrations/tripletex/route.ts) is
  // admin-only via requireCompanyAdmin — this offer-action gate is intentionally broader.
  if (!["admin", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!(await companyHasFeature(ctx.companyId, "integrasjoner"))) {
    return NextResponse.json({ error: "Tripletex-integrasjon er ikke aktiv på abonnementet." }, { status: 403 })
  }

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

  if (!offer.customer_id) {
    return NextResponse.json(
      { error: "Tilbud må være koblet til kunde før Tripletex-synk." },
      { status: 400 }
    )
  }

  const enqueued = await enqueueOfferTripletexSyncAndProcess({
    companyId: ctx.companyId,
    offerId: offer.id,
    customerId: offer.customer_id,
    projectId: offer.project_id || null,
    source: "manual",
  })

  if (!enqueued) {
    return NextResponse.json({ error: "Tripletex er ikke tilkoblet for denne bedriften." }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
