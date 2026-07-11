import { NextResponse } from "next/server"
import { z } from "zod"
import { logServerError } from "@/lib/errors/log"
import { zodValidationMessage } from "@/lib/errors/user-message"
import { createClient } from "@/lib/supabase/server"

// Store filer lastes opp i flere biter (klienten deler i bolker på 8 000
// rader for å holde seg under request-grensen på ~4,5 MB), så innsettingen av
// alle radene kan trenge mer enn standard funksjonstid.
export const maxDuration = 60

const MAX_TOTAL_ROWS = 100000

const rowSchema = z.object({
  produkt: z.string().optional(),
  nobb: z.string().optional(),
  ean: z.string().optional(),
  varekategori: z.string().optional(),
  varegruppekode: z.string().optional(),
  enhet: z.string().optional(),
  veil_pris: z.number().optional(),
  min_pris: z.number().optional(),
  rabatt: z.number().optional(),
  netto_pris: z.number().optional(),
  leverandor_id: z.string().optional(),
})

const saveSchema = z.object({
  supplierName: z.string().trim().optional(),
  fileName: z.string().trim().default(""),
  rows: z
    .array(rowSchema)
    .max(MAX_TOTAL_ROWS, "Fila kan ha maks 100 000 prisrader")
    .default([]),
  // Chunket opplasting: første kall har supplierName + total (oppretter fila i
  // status «uploading»), påfølgende kall har fileId, siste kall har done=true
  // (markerer fila «ready» slik at den tas i bruk).
  chunked: z
    .object({
      fileId: z.string().uuid().optional(),
      total: z.number().int().positive().max(MAX_TOTAL_ROWS, "Fila kan ha maks 100 000 prisrader").optional(),
      done: z.boolean().optional(),
    })
    .optional(),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { data, error } = await supabase
      .from("supplier_price_files")
      .select("id, supplier_name, original_filename, row_count, status, source, created_at")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[prisfiler GET]", error)
      await logServerError({
        message: "Henting av prisfiler feilet",
        error,
        source: "api",
        route: "/api/mine-priser/prisfiler GET",
      })
      return NextResponse.json({ error: "Kunne ikke hente prisfilene dine. Prøv igjen." }, { status: 500 })
    }
    return NextResponse.json({ files: data ?? [] })
  } catch (err) {
    console.error("[prisfiler GET] catch", err)
    await logServerError({
      message: "Henting av prisfiler feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/prisfiler GET",
    })
    return NextResponse.json({ error: "Kunne ikke hente prisfilene dine. Prøv igjen." }, { status: 500 })
  }
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
type ParsedRow = z.infer<typeof rowSchema>

// Batch insert rows in chunks of 500. Returns null on success, or an error
// response after best-effort cleanup of the file record (cascade removes rows).
async function insertRows(
  supabase: SupabaseServerClient,
  fileId: string,
  companyId: string,
  rows: ParsedRow[]
): Promise<NextResponse | null> {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => {
      const listPrice = row.veil_pris ?? null
      const discount = row.rabatt ?? null
      let netPrice = row.netto_pris ?? row.min_pris ?? null
      if (netPrice == null && listPrice != null && discount != null) {
        netPrice = listPrice * (1 - discount / 100)
      }
      // Build the row and omit keys whose value is null to stay resilient
      // against a stale PostgREST schema cache after column additions.
      const r: Record<string, unknown> = {
        file_id: fileId,
        company_id: companyId,
        product: row.produkt ?? null,
        nobb: row.nobb ?? null,
        ean: row.ean ?? null,
        category: row.varekategori ?? null,
        product_group_code: row.varegruppekode ?? null,
        unit: row.enhet ?? null,
        list_price: listPrice,
        min_price: row.min_pris ?? null,
        discount_percent: discount,
        net_price: netPrice,
        supplier_sku: row.leverandor_id ?? null,
      }
      // Strip top-level null values so stale schema cache won't reject unknown columns
      return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null))
    })

    const { error: rowError } = await supabase.from("supplier_price_rows").insert(chunk)
    if (rowError) {
      console.error("[prisfiler POST] row insert error", rowError)
      // Best-effort cleanup
      await supabase.from("supplier_price_files").delete().eq("id", fileId)
      await logServerError({
        message: "Prisfil: kunne ikke lagre prisrader",
        error: rowError,
        source: "api",
        route: "/api/mine-priser/prisfiler POST",
      })
      return NextResponse.json({ error: "Kunne ikke lagre prisradene. Prøv igjen." }, { status: 500 })
    }
  }
  return null
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()

    const companyId = userRow?.company_id
    if (!companyId) return NextResponse.json({ error: "Fant ikke bedrift" }, { status: 400 })

    const body = await request.json()
    const parsed = saveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: zodValidationMessage(parsed.error.flatten(), {
            supplierName: "Leverandørnavn",
            fileName: "Filnavn",
            rows: "Prisrader",
          }),
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const { supplierName, fileName, rows, chunked } = parsed.data

    // ── Fortsettelse av chunket opplasting ─────────────────────────────
    if (chunked?.fileId) {
      const { data: file } = await supabase
        .from("supplier_price_files")
        .select("id, status, company_id")
        .eq("id", chunked.fileId)
        .maybeSingle()

      if (!file || file.company_id !== companyId) {
        return NextResponse.json(
          { error: "Fant ikke prisfilen som lastes opp. Start opplastingen på nytt." },
          { status: 404 }
        )
      }
      if (file.status !== "uploading") {
        return NextResponse.json(
          { error: "Denne prisfilen er allerede ferdig lastet opp. Last opp fila på nytt hvis noe mangler." },
          { status: 409 }
        )
      }

      if (rows.length > 0) {
        const failure = await insertRows(supabase, file.id, companyId, rows)
        if (failure) return failure
      }

      if (chunked.done) {
        const { count } = await supabase
          .from("supplier_price_rows")
          .select("id", { count: "exact", head: true })
          .eq("file_id", file.id)

        const { error: finishError } = await supabase
          .from("supplier_price_files")
          .update({ status: "ready", row_count: count ?? 0, updated_at: new Date().toISOString() })
          .eq("id", file.id)

        if (finishError) {
          console.error("[prisfiler POST] finish error", finishError)
          await supabase.from("supplier_price_files").delete().eq("id", file.id)
          await logServerError({
            message: "Prisfil: kunne ikke fullføre chunket opplasting",
            error: finishError,
            source: "api",
            route: "/api/mine-priser/prisfiler POST",
          })
          return NextResponse.json(
            { error: "Kunne ikke fullføre opplastingen. Prøv igjen." },
            { status: 500 }
          )
        }
        return NextResponse.json({ id: file.id, rowCount: count ?? 0 })
      }

      return NextResponse.json({ id: file.id })
    }

    // ── Ny fil (alt i ett kall, eller første bit av chunket opplasting) ─
    if (!supplierName) {
      return NextResponse.json({ error: "Oppgi navn på leverandøren" }, { status: 400 })
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "Fila må inneholde minst én prisrad" }, { status: 400 })
    }

    const isChunkedStart = !!chunked
    const { data: fileRecord, error: fileError } = await supabase
      .from("supplier_price_files")
      .insert({
        company_id: companyId,
        supplier_name: supplierName,
        original_filename: fileName,
        row_count: isChunkedStart ? 0 : rows.length,
        // Chunkede filer er «uploading» til siste bit er inne, slik at
        // KI-tilbud og prissøket aldri leser en halvferdig fil.
        status: isChunkedStart ? "uploading" : "ready",
        created_by: user.id,
      })
      .select("id")
      .single()

    if (fileError || !fileRecord) {
      console.error("[prisfiler POST] file insert error", fileError)
      await logServerError({
        message: "Prisfil: kunne ikke opprette filoppføring",
        error: fileError,
        source: "api",
        route: "/api/mine-priser/prisfiler POST",
      })
      return NextResponse.json({ error: "Kunne ikke lagre prisfilen. Prøv igjen." }, { status: 500 })
    }

    const failure = await insertRows(supabase, fileRecord.id, companyId, rows)
    if (failure) return failure

    return NextResponse.json({ id: fileRecord.id })
  } catch (err) {
    console.error("[prisfiler POST] catch", err)
    await logServerError({
      message: "Lagring av prisfil feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/prisfiler POST",
    })
    return NextResponse.json({ error: "Kunne ikke lagre prisfilen. Prøv igjen." }, { status: 500 })
  }
}
