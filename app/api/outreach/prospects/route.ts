import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"

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

const deleteSchema = z.object({
  // Either delete a specific set of ids, or set all:true to wipe everything that
  // matches the (optional) filters below — the same filters as the GET list.
  ids: z.array(z.string().uuid()).max(5000).optional(),
  all: z.boolean().optional(),
  status: z.string().optional(),
  nace: z.string().optional(),
  kommune_number: z.string().optional(),
  has_email: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
})

// Bulk-delete prospects. CASCADE removes their prospect_outreach rows automatically.
// Existing customers (is_existing_customer=true) are never touched.
export async function DELETE(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }
  const { ids, all, status, nace, kommune_number, has_email, q } = parsed.data

  // Guard against an accidental full wipe: require an explicit id list or all:true.
  if (!all && !(ids && ids.length > 0)) {
    return NextResponse.json({ error: "Spesifiser «ids» eller «all: true»" }, { status: 400 })
  }

  const admin = createAdminClient()
  let query = admin.from("prospects").delete().eq("is_existing_customer", false)

  if (ids && ids.length > 0) {
    query = query.in("id", ids)
  } else {
    // all:true — apply the same optional filters as the list view so the seller can
    // "delete everything currently shown".
    if (status && status !== "all") query = query.eq("status", status)
    if (nace && nace !== "all") query = query.like("nace_code", `${nace}%`)
    if (kommune_number) query = query.eq("kommune_number", kommune_number)
    if (has_email === "true") query = query.not("email", "is", null)
    if (has_email === "false") query = query.is("email", null)
    if (q?.trim()) query = query.or(`name.ilike.%${q.trim()}%,org_number.ilike.%${q.trim()}%,city.ilike.%${q.trim()}%`)
  }

  const { data, error } = await query.select("id")
  if (error) {
    console.error("[outreach/prospects DELETE]", error)
    return NextResponse.json({ error: "Kunne ikke slette prospekter" }, { status: 500 })
  }

  const deleted = data?.length ?? 0
  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "delete_prospects",
    targetType: "prospects",
    metadata: { deleted, mode: ids && ids.length > 0 ? "ids" : "all", status: status ?? null },
  })

  return NextResponse.json({ deleted })
}
