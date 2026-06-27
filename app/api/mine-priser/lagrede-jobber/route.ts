import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

const saveSchema = z.object({
  name: z.string().trim().min(1).max(200),
  priceNok: z.number().finite().min(0).max(100_000_000),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { data, error } = await supabase
      .from("saved_jobs")
      .select("id, name, price_nok, sort_order, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })

    if (error) {
      console.error("[lagrede-jobber GET]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ jobs: data ?? [] })
  } catch (err) {
    console.error("[lagrede-jobber GET] catch", err)
    await logServerError({
      message: "Henting av lagrede jobber feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/lagrede-jobber GET",
    })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
    const companyId = userRow?.company_id
    if (!companyId) return NextResponse.json({ error: "Fant ikke bedrift" }, { status: 400 })

    const body = await request.json()
    const parsed = saveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data", details: parsed.error.flatten() }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("saved_jobs")
      .insert({
        company_id: companyId,
        name: parsed.data.name,
        price_nok: parsed.data.priceNok,
        created_by: user.id,
      })
      .select("id, name, price_nok, sort_order, created_at, updated_at")
      .single()

    if (error || !data) {
      console.error("[lagrede-jobber POST]", error)
      return NextResponse.json({ error: error?.message ?? "Kunne ikke opprette jobb" }, { status: 500 })
    }

    return NextResponse.json({ job: data })
  } catch (err) {
    console.error("[lagrede-jobber POST] catch", err)
    await logServerError({
      message: "Lagring av jobb feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/lagrede-jobber POST",
    })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
