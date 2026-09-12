import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { enrichFromWebsite, fetchBrregContact } from "@/lib/outreach/enrich"
import { regateProspect, type GateProspect } from "@/lib/outreach/regate"

export const maxDuration = 300

// «Finn kontaktinfo» retter seg mot leads som MANGLER E-POST — uavhengig av
// enrichment_status. (Den gamle versjonen behandlet kun status='pending', som
// aldri inntreffer når Brreg leverer telefon ved import: alt står som 'enriched'
// og knappen gjorde ingenting.) Kilder: Brreg-refetch, deretter nettside-skrap.

type PendingProspect = GateProspect & { phone: string | null }

async function chunked<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const body = (await request.json().catch(() => ({}))) as { limit?: number }
  const limit = Math.min(Math.max(body.limit ?? 15, 1), 40)
  const admin = createAdminClient()

  const { data: pending, error } = await admin
    .from("prospects")
    .select("*")
    .is("email", null)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    console.error("[outreach/enrich] load failed", error)
    await logServerError({
      message: "Kunne ikke hente prospekter for berikelse",
      error,
      source: "api",
      route: "POST /api/outreach/enrich",
      context: { userId: auth.user!.id, limit },
    })
    return NextResponse.json({ error: "Kunne ikke hente prospekter" }, { status: 500 })
  }

  const rows = (pending ?? []) as PendingProspect[]
  let enriched = 0
  let noContact = 0
  let emailOk = 0

  await chunked(rows, 5, async (row) => {
    let website = row.website
    let email: string | null = null
    let emailSource: "brreg" | "nettside" | null = null
    let phone: string | null = null

    // 1) Brreg-refetch når nettside mangler — hjemmeside/e-post/telefon kan ha
    //    kommet til etter importen (eller manglet i gamle importer).
    if (!website && row.org_number) {
      const brreg = await fetchBrregContact(row.org_number)
      if (brreg) {
        website = website ?? brreg.website
        email = brreg.email
        emailSource = brreg.email ? "brreg" : null
        phone = brreg.phone
      }
    }

    // 2) Nettside-skrap (forside + kontaktsider) hvis vi fortsatt mangler e-post.
    if (!email && website) {
      const scraped = await enrichFromWebsite(website)
      email = scraped.email
      emailSource = scraped.email ? "nettside" : null
      phone = phone ?? scraped.phone
    }

    if (email) enriched += 1
    else if (!row.phone && !phone) noContact += 1

    const updates: Record<string, unknown> = {
      enrichment_status: email || phone || row.phone ? "enriched" : "no_contact",
      updated_at: new Date().toISOString(),
    }
    // Bare skriv felter vi faktisk fant — aldri null ut eksisterende data.
    if (email) updates.email = email
    if (phone && !row.phone) updates.phone = phone
    if (website && !row.website) updates.website = website

    await admin.from("prospects").update(updates).eq("id", row.id)

    // Ny adresse → ny portdom: er den generell (post@) eller en person?
    // email_source settes her og ikke i updates over, så berikelsen virker også
    // før db/90 er kjørt (da feiler bare portdommen, som logges).
    if (email) {
      try {
        const outcome = await regateProspect(admin, {
          ...(row as GateProspect),
          email,
          website: website ?? row.website,
          email_source: emailSource,
        })
        if (outcome.policy === "epost_ok") emailOk += 1
      } catch (gateError) {
        console.warn("[outreach/enrich] portsjekk feilet", row.id, gateError)
      }
    }
  })

  return NextResponse.json({ processed: rows.length, enriched, noContact, emailOk })
}
