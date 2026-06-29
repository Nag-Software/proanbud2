"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUserRole } from "@/lib/auth-utils"
import { getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { canManageProjects } from "@/lib/roles"
import { geocodeAddress } from "@/lib/geo/geocode"
import { logServerError } from "@/lib/errors/log"

// The map is an admin/prosjektleder surface — never workers. Tenant isolation is
// enforced by RLS on every query (get_current_company_id), so the role gate here
// is purely about who may open the view, not which company's rows return.

export type KartProject = {
  id: string
  name: string
  status: string
  customerId: string | null
  address: string | null
  lat: number | null
  lng: number | null
}

export type KartCustomer = {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
}

export type KartData = {
  projects: KartProject[]
  customers: KartCustomer[]
}

/** True only for admin/manager. Workers can never read the map data. */
async function assertManager(): Promise<boolean> {
  const { canonicalRole } = await getCurrentUserRole()
  return canManageProjects(canonicalRole)
}

export async function getKartDataAction(): Promise<KartData> {
  if (!(await assertManager())) return { projects: [], customers: [] }

  const supabase = await createClient()
  const [{ data: projectRows }, { data: customerRows }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, customer_id, site_address, lat, lng")
      .order("updated_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, name, address, lat, lng")
      .order("name", { ascending: true }),
  ])

  const projects: KartProject[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? "Uten navn",
    status: (p.status as string) ?? "planning",
    customerId: (p.customer_id as string | null) ?? null,
    address: (p.site_address as string | null) ?? null,
    lat: (p.lat as number | null) ?? null,
    lng: (p.lng as number | null) ?? null,
  }))

  const customers: KartCustomer[] = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string) ?? "Uten navn",
    address: (c.address as string | null) ?? null,
    lat: (c.lat as number | null) ?? null,
    lng: (c.lng as number | null) ?? null,
  }))

  return { projects, customers }
}

export type SetSiteAddressResult = {
  ok: boolean
  address: string | null
  lat: number | null
  lng: number | null
  error?: string
}

// Set a project's SITE address (the construction site) and move its pin there.
// If the caller already picked a coordinate from autocomplete we trust it;
// otherwise we geocode the typed string. This is how the map becomes precise —
// the site, not the customer's office address.
export async function setProjectSiteAddressAction(
  projectId: string,
  address: string,
  lat?: number | null,
  lng?: number | null
): Promise<SetSiteAddressResult> {
  if (!(await assertManager())) {
    return { ok: false, address: null, lat: null, lng: null, error: "Ingen tilgang" }
  }

  const trimmed = (address || "").trim()
  if (!trimmed) {
    return { ok: false, address: null, lat: null, lng: null, error: "Adresse mangler" }
  }

  const { user } = await getCurrentUserRole()
  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId) {
    return { ok: false, address: null, lat: null, lng: null, error: "Mangler bedrift" }
  }

  try {
    let nextLat = typeof lat === "number" && Number.isFinite(lat) ? lat : null
    let nextLng = typeof lng === "number" && Number.isFinite(lng) ? lng : null
    if (nextLat == null || nextLng == null) {
      const hit = await geocodeAddress(trimmed)
      nextLat = hit?.lat ?? null
      nextLng = hit?.lng ?? null
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("projects")
      .update({ site_address: trimmed, lat: nextLat, lng: nextLng })
      .eq("id", projectId)
      .eq("company_id", companyId)
    if (error) {
      return { ok: false, address: null, lat: null, lng: null, error: "Kunne ikke lagre" }
    }

    revalidatePath("/kart")
    return { ok: true, address: trimmed, lat: nextLat, lng: nextLng }
  } catch (error) {
    await logServerError({
      message: "Lagring av byggeplassadresse feilet",
      error,
      source: "action",
      route: "setProjectSiteAddressAction",
      context: { projectId },
    })
    return { ok: false, address: null, lat: null, lng: null, error: "Lagring feilet" }
  }
}

export type GeocodeMissingResult = {
  ok: boolean
  customersGeocoded: number
  projectsGeocoded: number
  remaining: number
  error?: string
}

// Cap per run so a first-time backfill on a large account can't hang the request
// or hammer Kartverket; the button can simply be pressed again for the rest.
const MAX_PER_RUN = 80

export async function geocodeMissingKartAction(): Promise<GeocodeMissingResult> {
  if (!(await assertManager())) {
    return { ok: false, customersGeocoded: 0, projectsGeocoded: 0, remaining: 0, error: "Ingen tilgang" }
  }

  const { user } = await getCurrentUserRole()
  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId) {
    return { ok: false, customersGeocoded: 0, projectsGeocoded: 0, remaining: 0, error: "Mangler bedrift" }
  }

  const supabase = await createClient()
  let budget = MAX_PER_RUN
  let customersGeocoded = 0
  let projectsGeocoded = 0
  let remaining = 0

  try {
    // 1) Customers — geocode from their own address (street + postal + city).
    const { data: customerRows } = await supabase
      .from("customers")
      .select("id, address, postal_code, city, lat, lng")
      .eq("company_id", companyId)
      .is("lat", null)

    for (const c of customerRows ?? []) {
      const query = [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
        .trim()
      if (!query) continue
      if (budget <= 0) {
        remaining++
        continue
      }
      budget--
      const hit = await geocodeAddress(query)
      if (!hit) continue
      const { error } = await supabase
        .from("customers")
        .update({ lat: hit.lat, lng: hit.lng })
        .eq("id", c.id)
        .eq("company_id", companyId)
      if (!error) customersGeocoded++
    }

    // 2) Projects — prefer the project's own site address, fall back to the
    //    linked customer's address (the project site usually is the customer's).
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, site_address, lat, lng, customers(address, postal_code, city)")
      .eq("company_id", companyId)
      .is("lat", null)

    for (const p of projectRows ?? []) {
      const cust = (p as { customers?: { address?: string; postal_code?: string; city?: string } | null })
        .customers ?? null
      const fromCustomer = cust
        ? [cust.address, [cust.postal_code, cust.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
        : ""
      const query = ((p.site_address as string | null) || fromCustomer || "").trim()
      if (!query) continue
      if (budget <= 0) {
        remaining++
        continue
      }
      budget--
      const hit = await geocodeAddress(query)
      if (!hit) continue
      const { error } = await supabase
        .from("projects")
        .update({ lat: hit.lat, lng: hit.lng })
        .eq("id", p.id)
        .eq("company_id", companyId)
      if (!error) projectsGeocoded++
    }

    revalidatePath("/kart")
    return { ok: true, customersGeocoded, projectsGeocoded, remaining }
  } catch (error) {
    await logServerError({
      message: "Geokoding av kart-data feilet",
      error,
      source: "action",
      route: "geocodeMissingKartAction",
      context: { companyId },
    })
    return {
      ok: false,
      customersGeocoded,
      projectsGeocoded,
      remaining,
      error: "Geokoding feilet",
    }
  }
}
