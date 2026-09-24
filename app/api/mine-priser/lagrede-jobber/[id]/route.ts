import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { zodValidationMessage } from "@/lib/errors/user-message"
import { createClient } from "@/lib/supabase/server"
import { savedJobColumns, withSavedJobHoursFallback } from "@/lib/tilbud/saved-jobs"

const updateSchema = z.object({
  name: z.string().trim().min(1, "Oppgi navn på jobben").max(200, "Navnet er for langt (maks 200 tegn)"),
  priceNok: z
    .number()
    .finite()
    .min(0, "Prisen kan ikke være negativ")
    .max(100_000_000, "Prisen er for høy"),
  // Beregnede arbeidstimer — teller i timekalkylen når jobben brukes i et tilbud.
  estimatedHours: z
    .number()
    .finite()
    .min(0, "Timene kan ikke være negative")
    .max(100_000, "Timeantallet er for høyt")
    .nullable()
    .optional(),
})

const FIELD_LABELS = { name: "Navn", priceNok: "Pris", estimatedHours: "Timer" }

const JOB_COLUMNS = "id, name, price_nok, sort_order, created_at, updated_at"

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

    const { data, error } = await withSavedJobHoursFallback((withHours) =>
      supabase
        .from("saved_jobs")
        .update({
          name: parsed.data.name,
          price_nok: parsed.data.priceNok,
          // Bare når klienten sendte feltet — ellers ville en eldre klient nullstilt timene.
          ...(withHours && parsed.data.estimatedHours !== undefined
            ? { estimated_hours: parsed.data.estimatedHours }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select(savedJobColumns(JOB_COLUMNS, withHours))
        .maybeSingle()
    )

    if (error) {
      console.error("[lagrede-jobber PATCH]", error)
      await logServerError({
        message: "Endring av lagret jobb feilet",
        error,
        source: "api",
        route: "/api/mine-priser/lagrede-jobber/[id] PATCH",
      })
      return NextResponse.json({ error: "Kunne ikke lagre jobben. Prøv igjen." }, { status: 500 })
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
    return NextResponse.json({ error: "Kunne ikke lagre jobben. Prøv igjen." }, { status: 500 })
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
      await logServerError({
        message: "Sletting av lagret jobb feilet",
        error,
        source: "api",
        route: "/api/mine-priser/lagrede-jobber/[id] DELETE",
      })
      return NextResponse.json({ error: "Kunne ikke slette jobben. Prøv igjen." }, { status: 500 })
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
    return NextResponse.json({ error: "Kunne ikke slette jobben. Prøv igjen." }, { status: 500 })
  }
}
