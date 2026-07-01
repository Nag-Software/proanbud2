import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { zodValidationMessage } from "@/lib/errors/user-message"
import { createClient } from "@/lib/supabase/server"

const saveSchema = z.object({
  name: z.string().trim().min(1, "Oppgi navn på jobben").max(200, "Navnet er for langt (maks 200 tegn)"),
  priceNok: z
    .number()
    .finite()
    .min(0, "Prisen kan ikke være negativ")
    .max(100_000_000, "Prisen er for høy"),
})

const FIELD_LABELS = { name: "Navn", priceNok: "Pris" }

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
      await logServerError({
        message: "Henting av lagrede jobber feilet",
        error,
        source: "api",
        route: "/api/mine-priser/lagrede-jobber GET",
      })
      return NextResponse.json({ error: "Kunne ikke hente de lagrede jobbene. Prøv igjen." }, { status: 500 })
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
    return NextResponse.json({ error: "Kunne ikke hente de lagrede jobbene. Prøv igjen." }, { status: 500 })
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
      return NextResponse.json(
        { error: zodValidationMessage(parsed.error.flatten(), FIELD_LABELS), details: parsed.error.flatten() },
        { status: 400 }
      )
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
      await logServerError({
        message: "Lagring av jobb feilet",
        error,
        source: "api",
        route: "/api/mine-priser/lagrede-jobber POST",
      })
      return NextResponse.json({ error: "Kunne ikke lagre jobben. Prøv igjen." }, { status: 500 })
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
    return NextResponse.json({ error: "Kunne ikke lagre jobben. Prøv igjen." }, { status: 500 })
  }
}
