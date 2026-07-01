import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { zodValidationMessage } from "@/lib/errors/user-message"
import { createClient } from "@/lib/supabase/server"

const updateSchema = z.object({
  jobType: z.string().trim().min(1, "Oppgi type jobb").max(200, "Navnet er for langt (maks 200 tegn)"),
  hourlyRateNok: z
    .number()
    .finite()
    .min(0, "Timeprisen kan ikke være negativ")
    .max(1_000_000, "Timeprisen er for høy"),
})

const FIELD_LABELS = { jobType: "Type jobb", hourlyRateNok: "Timepris" }

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
      return NextResponse.json(
        { error: zodValidationMessage(parsed.error.flatten(), FIELD_LABELS), details: parsed.error.flatten() },
        { status: 400 }
      )
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
      await logServerError({
        message: "Endring av timepris feilet",
        error,
        source: "api",
        route: "/api/mine-priser/timepriser/[id] PATCH",
      })
      return NextResponse.json({ error: "Kunne ikke lagre timeprisen. Prøv igjen." }, { status: 500 })
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
    return NextResponse.json({ error: "Kunne ikke lagre timeprisen. Prøv igjen." }, { status: 500 })
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
      await logServerError({
        message: "Sletting av timepris feilet",
        error,
        source: "api",
        route: "/api/mine-priser/timepriser/[id] DELETE",
      })
      return NextResponse.json({ error: "Kunne ikke slette timeprisen. Prøv igjen." }, { status: 500 })
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
    return NextResponse.json({ error: "Kunne ikke slette timeprisen. Prøv igjen." }, { status: 500 })
  }
}
