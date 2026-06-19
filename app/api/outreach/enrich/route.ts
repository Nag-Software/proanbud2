import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { enrichFromWebsite } from "@/lib/outreach/enrich"

export const maxDuration = 60

type PendingProspect = { id: string; website: string | null }

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
    .select("id, website")
    .eq("enrichment_status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    console.error("[outreach/enrich] load failed", error)
    return NextResponse.json({ error: "Kunne ikke hente prospekter" }, { status: 500 })
  }

  const rows = (pending ?? []) as PendingProspect[]
  let enriched = 0
  let noContact = 0

  await chunked(rows, 5, async (row) => {
    const result = row.website ? await enrichFromWebsite(row.website) : { email: null, phone: null }
    const found = Boolean(result.email || result.phone)
    if (found) enriched += 1
    else noContact += 1

    await admin
      .from("prospects")
      .update({
        email: result.email,
        phone: result.phone,
        enrichment_status: found ? "enriched" : "no_contact",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
  })

  return NextResponse.json({ processed: rows.length, enriched, noContact })
}
