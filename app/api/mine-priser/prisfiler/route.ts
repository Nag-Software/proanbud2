import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

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
  supplierName: z.string().trim().min(1),
  fileName: z.string().trim().default(""),
  rows: z.array(rowSchema).min(1).max(50000),
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
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ files: data ?? [] })
  } catch (err) {
    console.error("[prisfiler GET] catch", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
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
      return NextResponse.json({ error: "Ugyldig data", details: parsed.error.flatten() }, { status: 400 })
    }

    const { supplierName, fileName, rows } = parsed.data

    // Insert the file record
    const { data: fileRecord, error: fileError } = await supabase
      .from("supplier_price_files")
      .insert({
        company_id: companyId,
        supplier_name: supplierName,
        original_filename: fileName,
        row_count: rows.length,
        status: "ready",
        created_by: user.id,
      })
      .select("id")
      .single()

    if (fileError || !fileRecord) {
      console.error("[prisfiler POST] file insert error", fileError)
      return NextResponse.json({ error: fileError?.message ?? "Kunne ikke opprette prisfil" }, { status: 500 })
    }

    // Batch insert rows in chunks of 500
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
          file_id: fileRecord.id,
          company_id: companyId,
          product: row.produkt ?? null,
          nobb: row.nobb ?? null,
          ean: row.ean ?? null,
          category: row.varekategori ?? null,
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
        await supabase.from("supplier_price_files").delete().eq("id", fileRecord.id)
        return NextResponse.json({ error: rowError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ id: fileRecord.id })
  } catch (err) {
    console.error("[prisfiler POST] catch", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
