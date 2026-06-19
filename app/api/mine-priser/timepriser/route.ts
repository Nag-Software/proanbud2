import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const saveSchema = z.object({
  jobType: z.string().trim().min(1).max(200),
  hourlyRateNok: z.number().finite().min(0).max(1_000_000),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { data, error } = await supabase
      .from("hourly_rates")
      .select("id, job_type, hourly_rate_nok, sort_order, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("job_type", { ascending: true })

    if (error) {
      console.error("[timepriser GET]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ rates: data ?? [] })
  } catch (err) {
    console.error("[timepriser GET] catch", err)
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
      .from("hourly_rates")
      .insert({
        company_id: companyId,
        job_type: parsed.data.jobType,
        hourly_rate_nok: parsed.data.hourlyRateNok,
        created_by: user.id,
      })
      .select("id, job_type, hourly_rate_nok, sort_order, created_at, updated_at")
      .single()

    if (error || !data) {
      console.error("[timepriser POST]", error)
      return NextResponse.json({ error: error?.message ?? "Kunne ikke opprette timepris" }, { status: 500 })
    }

    return NextResponse.json({ rate: data })
  } catch (err) {
    console.error("[timepriser POST] catch", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
