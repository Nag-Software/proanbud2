import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { companyHasModule } from "@/lib/billing/server-modules"
import {
  enqueueTripletexTravelExpenseDelete,
  enqueueTripletexTravelExpenseSync,
} from "@/lib/integrations/tripletex/sync"
import { logServerError } from "@/lib/errors/log"

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
  return { supabase, companyId: userRow.company_id as string, role: String(userRow.role || "") }
}

// Enqueue a reiseregning sync for one trip. Admins/managers only; the kjørebok
// module must be active and the Tripletex connection must have the travelExpenses
// scope enabled (enforced by the enqueue helper).
export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error
  if (!["admin", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!(await companyHasModule(ctx.companyId, "kjorebok"))) {
    return NextResponse.json({ error: "Kjørebok er ikke aktivert", code: "module_required" }, { status: 403 })
  }

  const { tripId } = await params
  const { data: trip } = await ctx.supabase
    .from("kjorebok_trips")
    .select("id, classification, tripletex_external_id")
    .eq("id", tripId)
    .eq("company_id", ctx.companyId)
    .maybeSingle()
  if (!trip) return NextResponse.json({ error: "Fant ikke kjøreturen" }, { status: 404 })
  if (trip.classification === "private") {
    return NextResponse.json({ error: "Privatturer overføres ikke til Tripletex" }, { status: 400 })
  }

  try {
    const enqueued = await enqueueTripletexTravelExpenseSync({ companyId: ctx.companyId, tripId })
    if (!enqueued) {
      return NextResponse.json(
        {
          error:
            "Tripletex-overføring av kjørebok er ikke aktivert. Skru på «Kjørebok / reiseregning» under Tripletex-innstillinger.",
          code: "scope_disabled",
        },
        { status: 400 }
      )
    }
    await ctx.supabase
      .from("kjorebok_trips")
      .update({ tripletex_status: "pending", tripletex_last_error: null })
      .eq("id", tripId)
      .eq("company_id", ctx.companyId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    await logServerError({
      message: "Kunne ikke overføre kjøretur til Tripletex",
      error,
      source: "api",
      route: "POST /api/kjorebok/[tripId]/tripletex",
      context: { companyId: ctx.companyId, tripId },
    })
    return NextResponse.json({ error: "Kunne ikke overføre" }, { status: 500 })
  }
}

// Un-sync: delete the Tripletex reiseregning and clear the local link.
export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error
  if (!["admin", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!(await companyHasModule(ctx.companyId, "kjorebok"))) {
    return NextResponse.json({ error: "Kjørebok er ikke aktivert", code: "module_required" }, { status: 403 })
  }

  const { tripId } = await params
  const { data: trip } = await ctx.supabase
    .from("kjorebok_trips")
    .select("id, tripletex_external_id")
    .eq("id", tripId)
    .eq("company_id", ctx.companyId)
    .maybeSingle()
  if (!trip) return NextResponse.json({ error: "Fant ikke kjøreturen" }, { status: 404 })
  if (!trip.tripletex_external_id) {
    return NextResponse.json({ ok: true })
  }

  try {
    await enqueueTripletexTravelExpenseDelete({
      companyId: ctx.companyId,
      tripId,
      externalId: Number(trip.tripletex_external_id),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    await logServerError({
      message: "Kunne ikke fjerne kjøretur fra Tripletex",
      error,
      source: "api",
      route: "DELETE /api/kjorebok/[tripId]/tripletex",
      context: { companyId: ctx.companyId, tripId },
    })
    return NextResponse.json({ error: "Kunne ikke fjerne fra Tripletex" }, { status: 500 })
  }
}
