import { NextResponse } from "next/server"

import { logServerError } from "@/lib/errors/log"
import { canAccessCustomers, canSendOffers } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"

// Globalt søk (⌘K-paletten): prosjekter, kunder og tilbud i egen bedrift.
// Spørres med brukerens klient så RLS gjelder (workers ser f.eks. bare egne
// prosjekter), i tillegg til eksplisitt company-scoping og rollefiltre som
// speiler sidene: kunder = canAccessCustomers, tilbud = canSendOffers.

const RESULT_LIMIT = 6

function sanitizeSearchTerm(value: string) {
  // % og _ er jokertegn i ilike — fjern dem så brukerinput aldri blir mønster
  return value.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim()
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })

    const url = new URL(request.url)
    const q = sanitizeSearchTerm(url.searchParams.get("q") || "")
    if (q.length < 2) {
      return NextResponse.json({ projects: [], customers: [], offers: [] })
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle()

    const companyId = userRow?.company_id
    if (!companyId) return NextResponse.json({ error: "Fant ikke bedrift" }, { status: 400 })

    const role = userRow?.role ?? null
    const pattern = `%${q}%`
    const emptyResult = { data: [] as never[], error: null }

    const [projectsRes, customersRes, offersRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, status")
        .eq("company_id", companyId)
        .ilike("name", pattern)
        .order("created_at", { ascending: false })
        .limit(RESULT_LIMIT),
      canAccessCustomers(role)
        ? supabase
            .from("customers")
            .select("id, name, city")
            .eq("company_id", companyId)
            .ilike("name", pattern)
            .order("created_at", { ascending: false })
            .limit(RESULT_LIMIT)
        : Promise.resolve(emptyResult),
      canSendOffers(role)
        ? supabase
            .from("offers")
            .select("id, title, status")
            .eq("company_id", companyId)
            .ilike("title", pattern)
            .order("created_at", { ascending: false })
            .limit(RESULT_LIMIT)
        : Promise.resolve(emptyResult),
    ])

    const firstError = projectsRes.error || customersRes.error || offersRes.error
    if (firstError) {
      await logServerError({
        message: "Globalt søk feilet",
        error: firstError,
        source: "api",
        route: "/api/sok/global GET",
        context: { companyId },
      })
    }

    return NextResponse.json({
      projects: (projectsRes.data ?? []).map((row: { id: string; name: string | null; status: string | null }) => ({
        id: row.id,
        name: row.name ?? "Uten navn",
        status: row.status,
      })),
      customers: (customersRes.data ?? []).map((row: { id: string; name: string | null; city: string | null }) => ({
        id: row.id,
        name: row.name ?? "Uten navn",
        city: row.city,
      })),
      offers: (offersRes.data ?? []).map((row: { id: string; title: string | null; status: string | null }) => ({
        id: row.id,
        title: row.title ?? "Uten tittel",
        status: row.status,
      })),
    })
  } catch (error) {
    await logServerError({
      message: "Globalt søk feilet uventet",
      error,
      source: "api",
      route: "/api/sok/global GET",
    })
    return NextResponse.json({ error: "Søket feilet. Prøv igjen." }, { status: 500 })
  }
}
