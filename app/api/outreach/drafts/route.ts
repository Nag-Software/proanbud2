import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("prospect_outreach")
    .select(
      "id, ai_subject, ai_body, status, created_at, prospect:prospects(id, name, email, city, status)"
    )
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: true })
    .limit(200)

  if (error) {
    console.error("[outreach/drafts GET]", error)
    return NextResponse.json({ error: "Kunne ikke hente utkast" }, { status: 500 })
  }

  return NextResponse.json({ drafts: data ?? [] })
}
