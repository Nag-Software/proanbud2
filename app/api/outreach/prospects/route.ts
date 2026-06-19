import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"

const PROSPECT_SELECT =
  "id, org_number, name, nace_code, nace_description, employee_count, website, email, phone, address, postal_code, city, kommune, kommune_number, enrichment_status, status, is_existing_customer, notes, last_contacted_at, created_at"

export async function GET(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const admin = createAdminClient()

  let query = admin
    .from("prospects")
    .select(PROSPECT_SELECT)
    .eq("is_existing_customer", false)
    .order("created_at", { ascending: false })
    .limit(Math.min(Number(searchParams.get("limit") ?? 300), 1000))

  const status = searchParams.get("status")
  if (status && status !== "all") query = query.eq("status", status)

  const nace = searchParams.get("nace")
  if (nace && nace !== "all") query = query.like("nace_code", `${nace}%`)

  const kommune = searchParams.get("kommune_number")
  if (kommune) query = query.eq("kommune_number", kommune)

  const hasEmail = searchParams.get("has_email")
  if (hasEmail === "true") query = query.not("email", "is", null)
  if (hasEmail === "false") query = query.is("email", null)

  const q = searchParams.get("q")?.trim()
  if (q) query = query.or(`name.ilike.%${q}%,org_number.ilike.%${q}%,city.ilike.%${q}%`)

  const { data, error } = await query
  if (error) {
    console.error("[outreach/prospects GET]", error)
    return NextResponse.json({ error: "Kunne ikke hente prospekter" }, { status: 500 })
  }

  return NextResponse.json({ prospects: data ?? [] })
}
