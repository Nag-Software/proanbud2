import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const search = (searchParams.get("q") ?? "").trim()
    const page = Math.max(0, parseInt(searchParams.get("page") ?? "0"))
    const LIMIT = 50

    const { data: file, error: fileError } = await supabase
      .from("supplier_price_files")
      .select("id, supplier_name, original_filename, row_count, created_at")
      .eq("id", id)
      .maybeSingle()

    if (fileError || !file) return NextResponse.json({ error: "Ikke funnet" }, { status: 404 })

    let query = supabase
      .from("supplier_price_rows")
      .select("id, product, nobb, ean, category, unit, list_price, min_price, discount_percent")
      .eq("file_id", id)
      .order("id")
      .range(page * LIMIT, page * LIMIT + LIMIT - 1)

    if (search) {
      const term = search.replace(/[%,]/g, "")
      if (term) {
        query = query.or(
          [
            `product.ilike.%${term}%`,
            `nobb.ilike.%${term}%`,
            `ean.ilike.%${term}%`,
          ].join(",")
        )
      }
    }

    const { data: rows, error: rowsError } = await query
    if (rowsError) return NextResponse.json({ error: rowsError.message }, { status: 500 })

    return NextResponse.json({ file, rows: rows ?? [], page, limit: LIMIT })
  } catch {
    return NextResponse.json({ error: "Serverfeil" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const { id } = await params

    // RLS ensures the file belongs to the user's company
    const { error } = await supabase
      .from("supplier_price_files")
      .delete()
      .eq("id", id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Serverfeil" }, { status: 500 })
  }
}
