"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUserRole } from "@/lib/auth-utils"
import { getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { canManageProjects } from "@/lib/roles"
import { geocodeAddress } from "@/lib/geo/geocode"
import { upsertProjectGeofence } from "@/lib/geo/project-geofence"
import { calculateSessionHours, unwrapRelation } from "@/lib/time-tracking"
import { logServerError } from "@/lib/errors/log"

// The live operations map (crew, avvik, budget, editing) is an admin/prosjektleder
// surface — every action here is manager-gated via assertManager(). Workers get a
// separate, read-only path (getKartWorkerProjectsAction) that returns just placed
// projects with no financial/ops data. Tenant isolation is enforced by RLS on every
// query (get_current_company_id), so the role gate is about who sees what, not which
// company's rows return.

export type KartProject = {
  id: string
  name: string
  status: string
  customerId: string | null
  address: string | null
  lat: number | null
  lng: number | null
  budgetNok: number | null
  endDate: string | null
}

// One worker currently clocked in on a project (an open time entry).
export type KartCrew = {
  userId: string
  name: string
  since: string | null
  gpsConfirmed: boolean
}

// Live operational signal per project — drives the pin badges and the detail
// panel. Refetched on a short poll so the map reads as "right now".
export type KartOps = {
  projectId: string
  crew: KartCrew[]
  hoursToday: number
  openAvvik: number
  overdueTasks: number
}

// A driven kjørebok route, simplified to a [lng,lat] polyline for the map.
export type KartTrip = {
  id: string
  coords: [number, number][]
}

export type KartCustomer = {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
}

export type GeoArea =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }

export type KartGeofence = {
  projectId: string
  kind: "polygon" | "circle"
  centerLat: number | null
  centerLng: number | null
  radiusM: number
  polygon: GeoArea | null
}

export type KartData = {
  projects: KartProject[]
  customers: KartCustomer[]
  geofences: KartGeofence[]
  ops: KartOps[]
}

// Local Oslo date (YYYY-MM-DD) for "today" comparisons. The DB stores entry_date
// as a local calendar day, so we compare against the Norwegian day, not UTC.
function osloToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date())
}

// Per-project live operations: who's clocked in now, hours logged today (closed
// entries + the live elapsed of open ones), open avvik, and overdue tasks. All
// queries are RLS-scoped to the caller's company.
async function fetchKartOps(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<KartOps[]> {
  const today = osloToday()
  const [{ data: openRows }, { data: todayRows }, { data: avvikRows }, { data: taskRows }] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select("project_id, user_id, started_at, source, check_in_lat, users(full_name, email)")
        .is("ended_at", null),
      supabase.from("time_entries").select("project_id, hours, started_at, ended_at").eq("entry_date", today),
      supabase.from("deviations").select("project_id").eq("status", "open"),
      supabase.from("tasks").select("project_id").neq("status", "done").not("due_date", "is", null).lt("due_date", today),
    ])

  const ops = new Map<string, KartOps>()
  const get = (projectId: string): KartOps => {
    let entry = ops.get(projectId)
    if (!entry) {
      entry = { projectId, crew: [], hoursToday: 0, openAvvik: 0, overdueTasks: 0 }
      ops.set(projectId, entry)
    }
    return entry
  }

  for (const r of openRows ?? []) {
    const projectId = r.project_id as string | null
    if (!projectId) continue
    const u = unwrapRelation(
      r.users as
        | { full_name: string | null; email: string | null }
        | { full_name: string | null; email: string | null }[]
        | null
    )
    get(projectId).crew.push({
      userId: r.user_id as string,
      name: u?.full_name || u?.email || "Ukjent",
      since: (r.started_at as string | null) ?? null,
      gpsConfirmed: r.source === "geofence" || r.check_in_lat != null,
    })
  }

  for (const r of todayRows ?? []) {
    const projectId = r.project_id as string | null
    if (!projectId) continue
    const closed = r.hours != null ? Number(r.hours) : null
    const live = r.ended_at == null && r.started_at ? calculateSessionHours(r.started_at as string) : 0
    get(projectId).hoursToday += closed ?? live
  }

  for (const r of avvikRows ?? []) {
    const projectId = r.project_id as string | null
    if (projectId) get(projectId).openAvvik += 1
  }

  for (const r of taskRows ?? []) {
    const projectId = r.project_id as string | null
    if (projectId) get(projectId).overdueTasks += 1
  }

  return Array.from(ops.values())
}

/** True only for admin/manager. Workers can never read the map data. */
async function assertManager(): Promise<boolean> {
  const { canonicalRole } = await getCurrentUserRole()
  return canManageProjects(canonicalRole)
}

export async function getKartDataAction(): Promise<KartData> {
  if (!(await assertManager())) return { projects: [], customers: [], geofences: [], ops: [] }

  const supabase = await createClient()
  const [{ data: projectRows }, { data: customerRows }, { data: geofenceRows }, ops] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, customer_id, site_address, lat, lng, budget_nok, end_date")
      .order("updated_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, name, address, lat, lng")
      .order("name", { ascending: true }),
    supabase
      .from("project_geofences")
      .select("project_id, geofence_kind, center_lat, center_lng, radius_m, polygon"),
    fetchKartOps(supabase),
  ])

  const projects: KartProject[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? "Uten navn",
    status: (p.status as string) ?? "planning",
    customerId: (p.customer_id as string | null) ?? null,
    address: (p.site_address as string | null) ?? null,
    lat: (p.lat as number | null) ?? null,
    lng: (p.lng as number | null) ?? null,
    budgetNok: (p.budget_nok as number | null) ?? null,
    endDate: (p.end_date as string | null) ?? null,
  }))

  const customers: KartCustomer[] = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string) ?? "Uten navn",
    address: (c.address as string | null) ?? null,
    lat: (c.lat as number | null) ?? null,
    lng: (c.lng as number | null) ?? null,
  }))

  const geofences: KartGeofence[] = (geofenceRows ?? []).map((g) => ({
    projectId: g.project_id as string,
    kind: (g.geofence_kind as "polygon" | "circle") ?? "circle",
    centerLat: (g.center_lat as number | null) ?? null,
    centerLng: (g.center_lng as number | null) ?? null,
    radiusM: (g.radius_m as number | null) ?? 100,
    polygon: (g.polygon as GeoArea | null) ?? null,
  }))

  return { projects, customers, geofences, ops }
}

// Just the live ops slice — for the client poll that keeps the map current
// without refetching projects/customers/geofences.
export async function getKartOpsAction(): Promise<KartOps[]> {
  if (!(await assertManager())) return []
  const supabase = await createClient()
  return fetchKartOps(supabase)
}

// Lean project shape for the read-only worker map — just enough to drop a pin
// and show a card. No budget, ops, geofence, or customer data ever reaches a
// worker client.
export type KartWorkerProject = {
  id: string
  name: string
  status: string
  address: string | null
  lat: number | null
  lng: number | null
}

// Placed projects the current user may see, for the worker locator map. NOT
// manager-gated: any authenticated company member may call it, and RLS
// (view_assigned_projects) already narrows the rows to the worker's own
// assigned projects. Returns strictly less than getKartDataAction, so this is
// safe to expose more broadly. Unplaced projects (no coords) are filtered out —
// workers can't geocode, so they'd only be invisible clutter.
export async function getKartWorkerProjectsAction(): Promise<KartWorkerProject[]> {
  // Redirects unauthenticated callers to /login; we don't need the role here.
  await getCurrentUserRole()
  const supabase = await createClient()
  const { data } = await supabase
    .from("projects")
    .select("id, name, status, site_address, lat, lng")
    .not("lat", "is", null)
    .order("updated_at", { ascending: false })

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? "Uten navn",
    status: (p.status as string) ?? "planning",
    address: (p.site_address as string | null) ?? null,
    lat: (p.lat as number | null) ?? null,
    lng: (p.lng as number | null) ?? null,
  }))
}

// Recent driven business routes for the optional "kjørebok" overlay. Prefers the
// stored simplified polyline; falls back to a straight from→to line. RLS-scoped.
export async function getKjorebokRoutesAction(): Promise<KartTrip[]> {
  if (!(await assertManager())) return []
  const supabase = await createClient()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const { data } = await supabase
    .from("kjorebok_trips")
    .select("id, route_geometry, from_lat, from_lng, to_lat, to_lng")
    .eq("classification", "business")
    .gte("trip_date", since)
    .order("trip_date", { ascending: false })
    .limit(300)

  const trips: KartTrip[] = []
  for (const t of data ?? []) {
    let coords: [number, number][] = []
    const rg = t.route_geometry as unknown
    if (Array.isArray(rg)) {
      coords = rg
        .filter(
          (pt): pt is [number, number] =>
            Array.isArray(pt) &&
            pt.length >= 2 &&
            Number.isFinite(pt[0]) &&
            Number.isFinite(pt[1])
        )
        .map((pt) => [pt[0], pt[1]])
    }
    if (coords.length < 2) {
      const fromLat = t.from_lat as number | null
      const fromLng = t.from_lng as number | null
      const toLat = t.to_lat as number | null
      const toLng = t.to_lng as number | null
      if (fromLat != null && fromLng != null && toLat != null && toLng != null) {
        coords = [
          [fromLng, fromLat],
          [toLng, toLat],
        ]
      }
    }
    if (coords.length >= 2) trips.push({ id: t.id as string, coords })
  }
  return trips
}

export type GeofenceResult = { ok: boolean; error?: string }

// Save a hand-tuned circular geofence (center + radius). Marked 'manuell' so the
// automatic teig/circle logic won't overwrite it on later address edits.
export async function setProjectGeofenceAction(
  projectId: string,
  centerLat: number,
  centerLng: number,
  radiusM: number
): Promise<GeofenceResult> {
  if (!(await assertManager())) return { ok: false, error: "Ingen tilgang" }
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return { ok: false, error: "Ugyldig posisjon" }
  }
  const radius = Math.round(Math.min(2000, Math.max(20, radiusM)))

  const { user } = await getCurrentUserRole()
  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId) return { ok: false, error: "Mangler bedrift" }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle()
  if (!project) return { ok: false, error: "Ugyldig prosjekt" }

  const { error } = await supabase.from("project_geofences").upsert(
    {
      company_id: companyId,
      project_id: projectId,
      geofence_kind: "circle",
      center_lat: centerLat,
      center_lng: centerLng,
      radius_m: radius,
      polygon: null,
      matrikkel_kommunenr: null,
      gnr: null,
      bnr: null,
      festenr: null,
      polygon_source: "manuell",
      srid: 4326,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  )
  if (error) {
    await logServerError({
      message: "Kunne ikke lagre manuell geofence",
      error,
      source: "action",
      route: "setProjectGeofenceAction",
      context: { projectId, companyId },
    })
    return { ok: false, error: "Kunne ikke lagre geofence" }
  }

  revalidatePath("/kart")
  return { ok: true }
}

// Discard a manual geofence and re-derive the automatic one (teig boundary, else
// 100 m circle) from the project's coordinates.
export async function resetProjectGeofenceAction(projectId: string): Promise<GeofenceResult> {
  if (!(await assertManager())) return { ok: false, error: "Ingen tilgang" }

  const { user } = await getCurrentUserRole()
  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId) return { ok: false, error: "Mangler bedrift" }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from("projects")
    .select("lat, lng")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle()
  if (!project) return { ok: false, error: "Ugyldig prosjekt" }

  await upsertProjectGeofence(
    companyId,
    projectId,
    (project.lat as number | null) ?? null,
    (project.lng as number | null) ?? null,
    { force: true }
  )

  revalidatePath("/kart")
  return { ok: true }
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

    await upsertProjectGeofence(companyId, projectId, nextLat, nextLng)

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
  geofencesBuilt: number
  remaining: number
  error?: string
}

// Cap per run so a first-time backfill on a large account can't hang the request
// or hammer Kartverket; the button can simply be pressed again for the rest.
const MAX_PER_RUN = 80

export async function geocodeMissingKartAction(): Promise<GeocodeMissingResult> {
  if (!(await assertManager())) {
    return { ok: false, customersGeocoded: 0, projectsGeocoded: 0, geofencesBuilt: 0, remaining: 0, error: "Ingen tilgang" }
  }

  const { user } = await getCurrentUserRole()
  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId) {
    return { ok: false, customersGeocoded: 0, projectsGeocoded: 0, geofencesBuilt: 0, remaining: 0, error: "Mangler bedrift" }
  }

  const supabase = await createClient()
  let budget = MAX_PER_RUN
  let customersGeocoded = 0
  let projectsGeocoded = 0
  let geofencesBuilt = 0
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

    // 3) Build a geofence (real teig boundary, else 100 m circle) for any project
    //    that now has coordinates but no stored geofence yet.
    const { data: coordRows } = await supabase
      .from("projects")
      .select("id, lat, lng")
      .eq("company_id", companyId)
      .not("lat", "is", null)
    const { data: fenceRows } = await supabase
      .from("project_geofences")
      .select("project_id")
      .eq("company_id", companyId)
    const haveFence = new Set((fenceRows ?? []).map((r) => r.project_id as string))

    for (const p of coordRows ?? []) {
      if (haveFence.has(p.id as string)) continue
      if (budget <= 0) {
        remaining++
        continue
      }
      budget--
      await upsertProjectGeofence(companyId, p.id as string, p.lat as number, p.lng as number)
      geofencesBuilt++
    }

    revalidatePath("/kart")
    return { ok: true, customersGeocoded, projectsGeocoded, geofencesBuilt, remaining }
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
      geofencesBuilt,
      remaining,
      error: "Geokoding feilet",
    }
  }
}
