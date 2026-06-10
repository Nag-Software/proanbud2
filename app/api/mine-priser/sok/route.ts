import { NextResponse } from "next/server"
import { z } from "zod"

import {
  type CompanyPriceRow,
  rankCompanyPriceRowsForPicker,
} from "@/lib/tilbud/company-price-utils"
import { mapSavedJobRows, pickRelevantSavedJobs, type SavedJobRow } from "@/lib/tilbud/saved-jobs"
import { createClient } from "@/lib/supabase/server"

const querySchema = z.object({
  q: z.string().trim().default(""),
  type: z.enum(["material", "job", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

function resolveUnitPrice(row: CompanyPriceRow) {
  if (typeof row.net_price === "number" && Number.isFinite(row.net_price) && row.net_price > 0) {
    return row.net_price
  }

  if (typeof row.list_price === "number" && Number.isFinite(row.list_price) && row.list_price > 0) {
    return row.list_price
  }

  return 0
}

function sanitizeSearchTerm(value: string) {
  return value.replace(/[%]/g, "").trim()
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })
    }

    const url = new URL(request.url)
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? "",
      type: url.searchParams.get("type") ?? "all",
      limit: url.searchParams.get("limit") ?? "20",
    })

    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig søk", details: parsed.error.flatten() }, { status: 400 })
    }

    const { q, type, limit } = parsed.data

    const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
    const companyId = (userRow as { company_id?: string | null } | null)?.company_id ?? null

    if (!companyId) {
      return NextResponse.json({ materials: [], jobs: [] })
    }

    let materials: Array<{
      id: string
      product: string
      unit: string
      unitPriceNok: number
      supplier: string
      nobb: string | null
      supplierSku: string | null
      category: string | null
    }> = []

    let jobs: SavedJobRow[] = []

    if (type === "material" || type === "all") {
      const { data: fileRows } = await supabase
        .from("supplier_price_files")
        .select("id, supplier_name")
        .eq("company_id", companyId)

      const supplierByFileId = new Map(
        ((fileRows ?? []) as Array<{ id: string; supplier_name: string | null }>).map((file) => [
          file.id,
          file.supplier_name?.trim() || "Prisfil",
        ])
      )

      let priceQuery = supabase
        .from("supplier_price_rows")
        .select("id, product, unit, net_price, list_price, category, nobb, supplier_sku, file_id, product_group_code, ean")
        .eq("company_id", companyId)
        .not("product", "is", null)
        .order("product", { ascending: true })
        .limit(Math.max(limit * 8, 80))

      const searchTerm = sanitizeSearchTerm(q)
      if (searchTerm) {
        priceQuery = priceQuery.or(
          [
            `product.ilike.%${searchTerm}%`,
            `nobb.ilike.%${searchTerm}%`,
            `supplier_sku.ilike.%${searchTerm}%`,
            `category.ilike.%${searchTerm}%`,
            `product_group_code.ilike.%${searchTerm}%`,
            `ean.ilike.%${searchTerm}%`,
          ].join(",")
        )
      }

      const { data: priceRows, error } = await priceQuery

      if (error) {
        console.error("[mine-priser/sok GET] price rows", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const enrichedRows = ((priceRows ?? []) as Array<CompanyPriceRow & { id: string; file_id?: string | null }>).map(
        (row) => ({
          ...row,
          supplier_name: row.file_id ? supplierByFileId.get(row.file_id) ?? "Prisfil" : "Prisfil",
        })
      )

      const rankedRows = searchTerm
        ? rankCompanyPriceRowsForPicker(enrichedRows, searchTerm, limit)
        : enrichedRows.slice(0, limit)

      materials = rankedRows.map((row) => {
        const typedRow = row as CompanyPriceRow & { id: string }
        return {
          id: typedRow.id,
          product: typedRow.product?.trim() || "Ukjent produkt",
          unit: typedRow.unit?.trim() || "stk",
          unitPriceNok: resolveUnitPrice(typedRow),
          supplier: typedRow.supplier_name?.trim() || "Prisfil",
          nobb: typedRow.nobb?.trim() || null,
          supplierSku: typedRow.supplier_sku?.trim() || null,
          category: typedRow.category?.trim() || null,
        }
      })
    }

    if (type === "job" || type === "all") {
      const { data: savedJobRows, error } = await supabase
        .from("saved_jobs")
        .select("id, name, price_nok")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })

      if (error) {
        console.error("[mine-priser/sok GET] saved jobs", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const mappedJobs = mapSavedJobRows((savedJobRows ?? []) as unknown[])
      jobs = q.trim() ? pickRelevantSavedJobs(mappedJobs, q, 1) : mappedJobs

      if (q.trim() && jobs.length === 0) {
        const normalizedQuery = q.trim().toLowerCase()
        jobs = mappedJobs
          .filter((job) => job.name.toLowerCase().includes(normalizedQuery))
          .slice(0, limit)
      } else {
        jobs = jobs.slice(0, limit)
      }
    }

    return NextResponse.json({ materials, jobs })
  } catch (err) {
    console.error("[mine-priser/sok GET] catch", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
