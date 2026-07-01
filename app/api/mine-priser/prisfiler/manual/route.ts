import { NextResponse } from "next/server"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { logServerError } from "@/lib/errors/log"
import { zodValidationMessage } from "@/lib/errors/user-message"
import { createClient } from "@/lib/supabase/server"

// Columns returned to the client so a freshly added/edited manual row renders
// identically to the rows fetched by the price-file viewer.
const ROW_SELECT = "id, product, nobb, ean, category, unit, list_price, min_price, discount_percent"

const createSchema = z.object({
  produkt: z
    .string()
    .trim()
    .min(1, "Produktnavn er påkrevd")
    .max(300, "Produktnavnet er for langt (maks 300 tegn)"),
  enhetspris: z.coerce.number().refine((n) => Number.isFinite(n) && n >= 0, "Oppgi en gyldig enhetspris"),
  enhet: z.string().trim().max(40, "Enheten er for lang (maks 40 tegn)").optional().default(""),
  leverandor: z
    .string()
    .trim()
    .min(1, "Leverandør er påkrevd")
    .max(120, "Leverandørnavnet er for langt (maks 120 tegn)"),
})

const patchSchema = z.object({
  rowId: z.string().uuid("Fant ikke prisen som skulle endres. Last siden på nytt og prøv igjen."),
  produkt: z
    .string()
    .trim()
    .min(1, "Produktnavn er påkrevd")
    .max(300, "Produktnavnet er for langt (maks 300 tegn)"),
  enhetspris: z.coerce.number().refine((n) => Number.isFinite(n) && n >= 0, "Oppgi en gyldig enhetspris"),
  enhet: z.string().trim().max(40, "Enheten er for lang (maks 40 tegn)").optional().default(""),
})

const FIELD_LABELS = {
  produkt: "Produkt",
  enhetspris: "Enhetspris",
  enhet: "Enhet",
  leverandor: "Leverandør",
  rowId: "Pris",
}

type Ctx = { supabase: SupabaseClient; userId: string; companyId: string }

async function resolveContext(): Promise<Ctx | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle()

  const companyId = (userRow as { company_id?: string | null } | null)?.company_id ?? null
  if (!companyId) return NextResponse.json({ error: "Fant ikke bedrift" }, { status: 400 })

  return { supabase, userId: user.id, companyId }
}

// Escape LIKE/ILIKE wildcards so a supplier name is matched literally (the
// partial unique index guarantees at most one manual file per supplier).
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

async function findOrCreateManualFile(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  supplierName: string
): Promise<string | null> {
  const name = supplierName.trim()

  const select = () =>
    supabase
      .from("supplier_price_files")
      .select("id")
      .eq("company_id", companyId)
      .eq("source", "manual")
      .ilike("supplier_name", escapeLike(name))
      .maybeSingle()

  const { data: existing } = await select()
  if (existing?.id) return existing.id

  const { data: created } = await supabase
    .from("supplier_price_files")
    .insert({
      company_id: companyId,
      supplier_name: name,
      original_filename: "",
      source: "manual",
      status: "ready",
      row_count: 0,
      created_by: userId,
    })
    .select("id")
    .single()

  if (created?.id) return created.id

  // Lost a race against a concurrent insert (unique index) — re-select.
  const { data: retry } = await select()
  return retry?.id ?? null
}

// Recompute and persist row_count for a manual file from its actual rows.
async function syncRowCount(supabase: SupabaseClient, fileId: string): Promise<number> {
  const { count, error } = await supabase
    .from("supplier_price_rows")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId)
  // Don't overwrite row_count with a bogus 0 if the recount failed.
  if (error) return count ?? 0
  const next = count ?? 0
  await supabase
    .from("supplier_price_files")
    .update({ row_count: next, updated_at: new Date().toISOString() })
    .eq("id", fileId)
  return next
}

// Fetch a row plus the source of its parent file, scoped to the company. Used to
// guarantee edit/delete only ever touch manually-added rows.
async function getManualRowFileId(
  supabase: SupabaseClient,
  companyId: string,
  rowId: string
): Promise<string | null | "not_manual"> {
  const { data } = await supabase
    .from("supplier_price_rows")
    .select("file_id, supplier_price_files!inner(source)")
    .eq("id", rowId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!data) return null
  const file = (data as { file_id: string | null; supplier_price_files?: { source?: string } | { source?: string }[] })
  const rel = file.supplier_price_files
  const source = Array.isArray(rel) ? rel[0]?.source : rel?.source
  if (source !== "manual") return "not_manual"
  return file.file_id ?? null
}

// ── Add a manual price ────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const ctx = await resolveContext()
    if (ctx instanceof NextResponse) return ctx
    const { supabase, userId, companyId } = ctx

    const parsed = createSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: zodValidationMessage(parsed.error.flatten(), FIELD_LABELS), details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { produkt, enhetspris, enhet, leverandor } = parsed.data

    const fileId = await findOrCreateManualFile(supabase, companyId, userId, leverandor)
    if (!fileId) {
      return NextResponse.json({ error: "Kunne ikke opprette leverandør" }, { status: 500 })
    }

    const { data: row, error: rowError } = await supabase
      .from("supplier_price_rows")
      .insert({
        file_id: fileId,
        company_id: companyId,
        product: produkt,
        unit: enhet || null,
        list_price: enhetspris,
        net_price: enhetspris,
      })
      .select(ROW_SELECT)
      .single()

    if (rowError || !row) {
      console.error("[prisfiler/manual POST]", rowError)
      await logServerError({
        message: "Lagring av manuell pris feilet",
        error: rowError,
        source: "api",
        route: "/api/mine-priser/prisfiler/manual POST",
      })
      return NextResponse.json({ error: "Kunne ikke lagre prisen. Prøv igjen." }, { status: 500 })
    }

    const rowCount = await syncRowCount(supabase, fileId)
    return NextResponse.json({ fileId, row, rowCount })
  } catch (err) {
    console.error("[prisfiler/manual POST] catch", err)
    await logServerError({
      message: "Lagring av manuell pris feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/prisfiler/manual POST",
    })
    return NextResponse.json({ error: "Kunne ikke lagre prisen. Prøv igjen." }, { status: 500 })
  }
}

// ── Edit a manual price (product / unit / unit price; not supplier) ───────────
export async function PATCH(request: Request) {
  try {
    const ctx = await resolveContext()
    if (ctx instanceof NextResponse) return ctx
    const { supabase, companyId } = ctx

    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: zodValidationMessage(parsed.error.flatten(), FIELD_LABELS), details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { rowId, produkt, enhetspris, enhet } = parsed.data

    const fileId = await getManualRowFileId(supabase, companyId, rowId)
    if (fileId === null) return NextResponse.json({ error: "Ikke funnet" }, { status: 404 })
    if (fileId === "not_manual") {
      return NextResponse.json({ error: "Kan bare endre manuelle priser" }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from("supplier_price_rows")
      .update({
        product: produkt,
        unit: enhet || null,
        list_price: enhetspris,
        net_price: enhetspris,
      })
      .eq("id", rowId)
      .eq("company_id", companyId)
      .select(ROW_SELECT)
      .single()

    if (error || !row) {
      console.error("[prisfiler/manual PATCH]", error)
      await logServerError({
        message: "Endring av manuell pris feilet",
        error,
        source: "api",
        route: "/api/mine-priser/prisfiler/manual PATCH",
      })
      return NextResponse.json({ error: "Kunne ikke lagre endringen. Prøv igjen." }, { status: 500 })
    }

    return NextResponse.json({ row })
  } catch (err) {
    console.error("[prisfiler/manual PATCH] catch", err)
    await logServerError({
      message: "Endring av manuell pris feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/prisfiler/manual PATCH",
    })
    return NextResponse.json({ error: "Kunne ikke lagre endringen. Prøv igjen." }, { status: 500 })
  }
}

// ── Delete a manual price (and the supplier card when it becomes empty) ────────
export async function DELETE(request: Request) {
  try {
    const ctx = await resolveContext()
    if (ctx instanceof NextResponse) return ctx
    const { supabase, companyId } = ctx

    const rowId = new URL(request.url).searchParams.get("rowId")
    if (!rowId) return NextResponse.json({ error: "Mangler rowId" }, { status: 400 })

    const fileId = await getManualRowFileId(supabase, companyId, rowId)
    if (fileId === null) return NextResponse.json({ error: "Ikke funnet" }, { status: 404 })
    if (fileId === "not_manual") {
      return NextResponse.json({ error: "Kan bare slette manuelle priser" }, { status: 400 })
    }

    const { error } = await supabase
      .from("supplier_price_rows")
      .delete()
      .eq("id", rowId)
      .eq("company_id", companyId)

    if (error) {
      console.error("[prisfiler/manual DELETE]", error)
      await logServerError({
        message: "Sletting av manuell pris feilet",
        error,
        source: "api",
        route: "/api/mine-priser/prisfiler/manual DELETE",
      })
      return NextResponse.json({ error: "Kunne ikke slette prisen. Prøv igjen." }, { status: 500 })
    }

    if (!fileId) return NextResponse.json({ ok: true, fileDeleted: false })

    const { count, error: countError } = await supabase
      .from("supplier_price_rows")
      .select("id", { count: "exact", head: true })
      .eq("file_id", fileId)

    // A null count from a transient error must NOT be treated as "empty" — that
    // would delete the file and cascade-delete any surviving sibling rows. The
    // row delete already succeeded, so report success and leave the file alone.
    if (countError) {
      return NextResponse.json({ ok: true, fileDeleted: false, fileId })
    }

    if ((count ?? 0) === 0) {
      await supabase.from("supplier_price_files").delete().eq("id", fileId)
      return NextResponse.json({ ok: true, fileDeleted: true, fileId })
    }

    await supabase
      .from("supplier_price_files")
      .update({ row_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq("id", fileId)

    return NextResponse.json({ ok: true, fileDeleted: false, fileId, rowCount: count ?? 0 })
  } catch (err) {
    console.error("[prisfiler/manual DELETE] catch", err)
    await logServerError({
      message: "Sletting av manuell pris feilet",
      error: err,
      source: "api",
      route: "/api/mine-priser/prisfiler/manual DELETE",
    })
    return NextResponse.json({ error: "Kunne ikke slette prisen. Prøv igjen." }, { status: 500 })
  }
}
