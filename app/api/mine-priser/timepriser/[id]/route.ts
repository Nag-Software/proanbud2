import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

const updateSchema = z.object({
  jobType: z.string().trim().min(1).max(200),
  hourlyRateNok: z.number().finite().min(0).max(1_000_000),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data", details: parsed.error.flatten() }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("hourly_rates")
      .update({
        job_type: parsed.data.jobType,
        hourly_rate_nok: parsed.data.hourlyRateNok,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, job_type, hourly_rate_nok, sort_order, created_at, updated_at")
      .maybeSingle()

    if (error) {
      console.error("[timepriser PATCH]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: "Ikke funnet" }, { status: 404 })

    return NextResponse.json({ rate: data })
  } catch (err) {
    console.error("[timepriser PATCH] catch", err)
    await logServerError({
      message: "Endring av timepris feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/timepriser/[id] PATCH",
    })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { id } = await params
    const { error } = await supabase.from("hourly_rates").delete().eq("id", id)

    if (error) {
      console.error("[timepriser DELETE]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[timepriser DELETE] catch", err)
    await logServerError({
      message: "Sletting av timepris feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/timepriser/[id] DELETE",
    })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
