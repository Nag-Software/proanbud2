import { NextResponse } from "next/server"

import { companyHasFeature } from "@/lib/billing/server-modules"
import { ACCOUNTING_PROVIDER_LABELS } from "@/lib/regnskap/types"
import { fetchOfferAccountingStatus } from "@/lib/regnskap/status"
import { enqueueOfferSync, resolveAccountingProviderId } from "@/lib/regnskap/sync"
import { createClient } from "@/lib/supabase/server"

/**
 * Én rute for «hvor er dette tilbudet i regnskapet?» og «synk det nå», uansett
 * om bedriften kjører Fiken eller Tripletex.
 *
 * Erstatter /tripletex-sync og /fiken-sync, som lever videre som tynne aliaser
 * — gamle lenker og bokmerker skal aldri knekke.
 */

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

async function loadOffer(ctx: { supabase: Awaited<ReturnType<typeof createClient>>; companyId: string }, id: string) {
  const { data } = await ctx.supabase
    .from("offers")
    .select("id, customer_id, project_id")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle()
  return data
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params
  const offer = await loadOffer(ctx, id)
  if (!offer) {
    return NextResponse.json({ error: "Fant ikke tilbudet." }, { status: 404 })
  }

  const status = await fetchOfferAccountingStatus({
    companyId: ctx.companyId,
    offerId: offer.id,
    customerId: offer.customer_id,
    projectId: offer.project_id,
  })

  return NextResponse.json({ ok: true, ...status })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  // Muterende: oppretter faktisk tilbud/ordre i regnskapet. Admin og leder kan
  // utløse en synk (samme nivå som retry-failed), og integrasjonsplanen må være
  // aktiv. Tilkoblingsrutene er strengere (kun admin) — det er med vilje.
  if (!["admin", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!(await companyHasFeature(ctx.companyId, "integrasjoner"))) {
    return NextResponse.json(
      { error: "Regnskapsintegrasjon er ikke aktiv på abonnementet." },
      { status: 403 }
    )
  }

  const { id } = await params
  const offer = await loadOffer(ctx, id)
  if (!offer) {
    return NextResponse.json({ error: "Fant ikke tilbudet." }, { status: 404 })
  }

  if (!offer.customer_id) {
    return NextResponse.json(
      { error: "Tilbudet må være koblet til en kunde før det kan synkes til regnskapet." },
      { status: 400 }
    )
  }

  const provider = await enqueueOfferSync({
    companyId: ctx.companyId,
    offerId: offer.id,
    customerId: offer.customer_id,
    projectId: offer.project_id || null,
    source: "manual",
  })

  if (!provider) {
    // Skill mellom «ingenting tilkoblet» og «tilkoblet, men oppsettet er ikke ferdig»
    // — ellers sender vi brukeren til feil sted for å fikse det.
    const connected = await resolveAccountingProviderId(ctx.companyId)
    return NextResponse.json(
      {
        error: connected
          ? `${ACCOUNTING_PROVIDER_LABELS[connected]} er tilkoblet, men oppsettet er ikke fullført.`
          : "Ingen regnskapsintegrasjon er tilkoblet for denne bedriften.",
      },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true, provider })
}
