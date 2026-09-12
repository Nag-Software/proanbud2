import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Søk i prospekter. Brukes når Casper skal koble et ukjent svar til riktig
 * lead — da er firmanavnet eller e-postdomenet alt han har.
 */
export async function GET(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const query = (searchParams.get("q") ?? "").trim()
  const limit = Math.min(Number(searchParams.get("limit")) || 8, 25)

  if (query.length < 2) return NextResponse.json({ prospects: [] })

  // Escape for PostgREST-mønstre: % og _ er jokertegn, komma deler filteret.
  const safe = query.replace(/[%_,()]/g, " ").trim()
  if (!safe) return NextResponse.json({ prospects: [] })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("prospects")
    .select("id, name, email, city, domain, status")
    .or(`name.ilike.%${safe}%,email.ilike.%${safe}%,domain.ilike.%${safe}%`)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ prospects: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ prospects: data ?? [] })
}
