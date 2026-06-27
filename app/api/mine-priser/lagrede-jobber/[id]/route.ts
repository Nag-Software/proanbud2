import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  priceNok: z.number().finite().min(0).max(100_000_000),
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
      .from("saved_jobs")
      .update({
        name: parsed.data.name,
        price_nok: parsed.data.priceNok,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, name, price_nok, sort_order, created_at, updated_at")
      .maybeSingle()

    if (error) {
      console.error("[lagrede-jobber PATCH]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: "Ikke funnet" }, { status: 404 })

    return NextResponse.json({ job: data })
  } catch (err) {
    console.error("[lagrede-jobber PATCH] catch", err)
    await logServerError({
      message: "Endring av lagret jobb feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/lagrede-jobber/[id] PATCH",
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
    const { error } = await supabase.from("saved_jobs").delete().eq("id", id)

    if (error) {
      console.error("[lagrede-jobber DELETE]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[lagrede-jobber DELETE] catch", err)
    await logServerError({
      message: "Sletting av lagret jobb feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/lagrede-jobber/[id] DELETE",
    })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
