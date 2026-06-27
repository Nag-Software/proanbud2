"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import { assertCompanyHasModule, companyHasModule } from "@/lib/billing/server-modules"
import { canManageProjects, normalizeRole } from "@/lib/roles"
import { computeTripAmount } from "@/lib/kjorebok/rates"
import { computeFuelCost } from "@/lib/kjorebok/fuel"
import type {
  FuelType,
  TripFilter,
  TripInput,
  TripsOverview,
  TripWithRefs,
  VehicleInput,
  VehicleRow,
} from "@/lib/kjorebok/types"

const KJOREBOK_MODULE = "kjorebok" as const

async function getEffectiveRole(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: userRoleData } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId)
    .maybeSingle()

  const { data: userTableData } = await supabase
    .from("users")
    .select("role, company_id")
    .eq("id", userId)
    .maybeSingle()

  // @ts-expect-error Supabase nested relation typing
  const role = userRoleData?.roles?.name || userTableData?.role || null

  return { role, companyId: (userTableData?.company_id as string | null) || null }
}

async function hasKjorebokModule(companyId: string | null): Promise<boolean> {
  if (!companyId) return false
  return companyHasModule(companyId, KJOREBOK_MODULE)
}

/** Extract the sats-year from a "YYYY-MM-DD" trip date. */
function yearFromDate(dateIso: string): number {
  const y = Number(dateIso?.slice(0, 4))
  return Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear()
}

/** Normalise a fuel-consumption (l/mil) input to a non-negative number or null. */
function normalizeConsumption(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

type VehicleFuel = { fuelType: FuelType | null; consumptionLPerMil: number | null }

/** Fetch a vehicle's fuel context (type + consumption) for the fuel-cost snapshot. */
async function getVehicleFuel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  vehicleId: string | null | undefined
): Promise<VehicleFuel | null> {
  if (!vehicleId) return null
  const { data } = await supabase
    .from("kjorebok_vehicles")
    .select("fuel_type, fuel_consumption_l_per_mil")
    .eq("id", vehicleId)
    .eq("company_id", companyId)
    .maybeSingle()
  if (!data) return null
  return {
    fuelType: (data.fuel_type as FuelType | null) ?? null,
    consumptionLPerMil: (data.fuel_consumption_l_per_mil as number | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export async function getVehiclesAction(): Promise<VehicleRow[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { companyId } = await getEffectiveRole(supabase, user.id)
  if (!(await hasKjorebokModule(companyId))) return []

  const { data, error } = await supabase
    .from("kjorebok_vehicles")
    .select("*")
    .eq("company_id", companyId!)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true })

  if (error) {
    await logServerError({
      message: "Kunne ikke hente kjøretøy",
      error,
      source: "action",
      route: "getVehiclesAction",
      context: { userId: user.id, companyId },
    })
    return []
  }
  return (data || []) as VehicleRow[]
}

export async function createVehicleAction(input: VehicleInput): Promise<VehicleRow> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const name = input.name?.trim()
  if (!name) throw new Error("Kjøretøyet må ha et navn")

  const { data, error } = await supabase
    .from("kjorebok_vehicles")
    .insert({
      company_id: companyId,
      name,
      registration: input.registration?.trim() || null,
      fuel_type: input.fuelType || null,
      fuel_consumption_l_per_mil: normalizeConsumption(input.fuelConsumptionLPerMil),
      default_driver: input.defaultDriver || null,
      is_active: input.isActive ?? true,
      notes: input.notes?.trim() || null,
      created_by: user.id,
    })
    .select("*")
    .single()

  if (error) {
    await logServerError({
      message: "Kunne ikke opprette kjøretøy",
      error,
      source: "action",
      route: "createVehicleAction",
      context: { userId: user.id, companyId },
    })
    throw new Error("Kunne ikke lagre kjøretøy")
  }

  revalidatePath("/min-bedrift/kjorebok")
  return data as VehicleRow
}

export async function updateVehicleAction(id: string, patch: Partial<VehicleInput>): Promise<VehicleRow> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const name = patch.name?.trim()
    if (!name) throw new Error("Kjøretøyet må ha et navn")
    update.name = name
  }
  if (patch.registration !== undefined) update.registration = patch.registration?.trim() || null
  if (patch.fuelType !== undefined) update.fuel_type = patch.fuelType || null
  if (patch.fuelConsumptionLPerMil !== undefined) {
    update.fuel_consumption_l_per_mil = normalizeConsumption(patch.fuelConsumptionLPerMil)
  }
  if (patch.defaultDriver !== undefined) update.default_driver = patch.defaultDriver || null
  if (patch.isActive !== undefined) update.is_active = patch.isActive
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null

  const { data, error } = await supabase
    .from("kjorebok_vehicles")
    .update(update)
    .eq("id", id)
    .eq("company_id", companyId!)
    .select("*")
    .single()

  if (error) {
    await logServerError({
      message: "Kunne ikke oppdatere kjøretøy",
      error,
      source: "action",
      route: "updateVehicleAction",
      context: { userId: user.id, companyId, vehicleId: id },
    })
    throw new Error("Kunne ikke oppdatere kjøretøy")
  }

  revalidatePath("/min-bedrift/kjorebok")
  return data as VehicleRow
}

export async function deleteVehicleAction(id: string): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const { error } = await supabase
    .from("kjorebok_vehicles")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId!)

  if (error) {
    await logServerError({
      message: "Kunne ikke slette kjøretøy",
      error,
      source: "action",
      route: "deleteVehicleAction",
      context: { userId: user.id, companyId, vehicleId: id },
    })
    throw new Error("Kunne ikke slette kjøretøy")
  }

  revalidatePath("/min-bedrift/kjorebok")
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

const TRIP_SELECT =
  "*, project:projects(name), vehicle:kjorebok_vehicles(name)"

type RawTripRow = TripWithRefs & {
  project?: { name: string } | { name: string }[] | null
  vehicle?: { name: string } | { name: string }[] | null
}

function flattenRel<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

/** Build the date range [from, toExclusive) for a "YYYY-MM" filter. */
function monthRange(month: string): { from: string; toExclusive: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [y, m] = month.split("-").map(Number)
  const from = `${month}-01`
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
  return { from, toExclusive: `${next}-01` }
}

function attachDriverNames(rows: RawTripRow[], driverNames: Map<string, string | null>): TripWithRefs[] {
  return rows.map((r) => ({
    ...(r as TripWithRefs),
    driver_name: driverNames.get(r.driver_user_id) ?? null,
    project_name: flattenRel(r.project)?.name ?? null,
    vehicle_name: flattenRel(r.vehicle)?.name ?? null,
  }))
}

export async function getCompanyTripsOverviewAction(filter?: TripFilter): Promise<TripsOverview> {
  const empty: TripsOverview = {
    canViewAll: false,
    totals: { km: 0, amountNok: 0, fuelCostNok: 0, businessKm: 0, privateKm: 0, tripCount: 0, driverCount: 0 },
    trips: [],
    byProject: [],
    byDriver: [],
    drivers: [],
    projects: [],
    vehicles: [],
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return empty

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !(await hasKjorebokModule(companyId))) return empty

  const canViewAll = canManageProjects(role) || normalizeRole(role) === "admin"

  let query = supabase
    .from("kjorebok_trips")
    .select(TRIP_SELECT)
    .eq("company_id", companyId)
    .order("trip_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000)

  if (!canViewAll) query = query.eq("driver_user_id", user.id)
  if (filter?.driverId) query = query.eq("driver_user_id", filter.driverId)
  if (filter?.projectId) query = query.eq("project_id", filter.projectId)
  if (filter?.classification) query = query.eq("classification", filter.classification)
  if (filter?.month) {
    const range = monthRange(filter.month)
    if (range) query = query.gte("trip_date", range.from).lt("trip_date", range.toExclusive)
  }

  const [{ data: tripData, error: tripError }, { data: driverData }, { data: projectData }, vehicles] =
    await Promise.all([
      query,
      supabase
        .from("users")
        .select("id, full_name")
        .eq("company_id", companyId)
        .order("full_name", { ascending: true }),
      supabase
        .from("projects")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      getVehiclesAction(),
    ])

  if (tripError) {
    await logServerError({
      message: "Kunne ikke hente kjørebok-oversikt",
      error: tripError,
      source: "action",
      route: "getCompanyTripsOverviewAction",
      context: { userId: user.id, companyId, canViewAll },
    })
    return { ...empty, canViewAll }
  }

  const driverNames = new Map<string, string | null>(
    (driverData || []).map((d) => [d.id as string, (d.full_name as string) ?? null])
  )
  const trips = attachDriverNames((tripData || []) as RawTripRow[], driverNames)

  // Totals: reimbursable amount + km counts. Private km are tracked but excluded
  // from the reimbursable amount total.
  const totals = trips.reduce(
    (acc, t) => {
      const km = Number(t.distance_km || 0)
      acc.km += km
      if (t.classification === "private") {
        acc.privateKm += km
      } else {
        acc.businessKm += km
        acc.amountNok += Number(t.amount_nok || 0)
        acc.fuelCostNok += Number(t.fuel_cost_nok || 0)
      }
      return acc
    },
    { km: 0, amountNok: 0, fuelCostNok: 0, businessKm: 0, privateKm: 0, tripCount: trips.length, driverCount: 0 }
  )
  totals.driverCount = new Set(trips.map((t) => t.driver_user_id)).size

  // Per-project and per-driver breakdowns (business amount only).
  const byProjectMap = new Map<string, { projectName: string | null; km: number; amountNok: number }>()
  const byDriverMap = new Map<string, { driverName: string | null; km: number; amountNok: number }>()
  for (const t of trips) {
    const pk = t.project_id ?? "__none__"
    const p = byProjectMap.get(pk) ?? { projectName: t.project_name, km: 0, amountNok: 0 }
    p.km += Number(t.distance_km || 0)
    if (t.classification !== "private") p.amountNok += Number(t.amount_nok || 0)
    byProjectMap.set(pk, p)

    const d = byDriverMap.get(t.driver_user_id) ?? { driverName: t.driver_name, km: 0, amountNok: 0 }
    d.km += Number(t.distance_km || 0)
    if (t.classification !== "private") d.amountNok += Number(t.amount_nok || 0)
    byDriverMap.set(t.driver_user_id, d)
  }

  return {
    canViewAll,
    totals,
    trips,
    byProject: Array.from(byProjectMap.entries()).map(([k, v]) => ({
      projectId: k === "__none__" ? null : k,
      projectName: v.projectName,
      km: v.km,
      amountNok: v.amountNok,
    })),
    byDriver: Array.from(byDriverMap.entries()).map(([k, v]) => ({
      driverId: k,
      driverName: v.driverName,
      km: v.km,
      amountNok: v.amountNok,
    })),
    drivers: (driverData || []).map((d) => ({ id: d.id as string, name: (d.full_name as string) ?? null })),
    projects: (projectData || []).map((p) => ({ id: p.id as string, name: p.name as string })),
    vehicles,
  }
}

export type TripFormContext = {
  canViewAll: boolean
  drivers: Array<{ id: string; name: string | null }>
  projects: Array<{ id: string; name: string }>
  vehicles: VehicleRow[]
}

/** Lightweight context for the "Ny tur" form (drivers/projects/vehicles + role),
 *  without pulling the full trip list the overview returns. */
export async function getTripFormContextAction(): Promise<TripFormContext> {
  const empty: TripFormContext = { canViewAll: false, drivers: [], projects: [], vehicles: [] }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return empty

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !(await hasKjorebokModule(companyId))) return empty

  const canViewAll = canManageProjects(role) || normalizeRole(role) === "admin"

  const [{ data: driverData }, { data: projectData }, vehicles] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    getVehiclesAction(),
  ])

  return {
    canViewAll,
    drivers: (driverData || []).map((d) => ({ id: d.id as string, name: (d.full_name as string) ?? null })),
    projects: (projectData || []).map((p) => ({ id: p.id as string, name: p.name as string })),
    vehicles,
  }
}

export async function getProjectTripsAction(projectId: string, viewAll = false): Promise<TripWithRefs[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !(await hasKjorebokModule(companyId))) return []

  const canViewAll = (canManageProjects(role) || normalizeRole(role) === "admin") && viewAll

  let query = supabase
    .from("kjorebok_trips")
    .select(TRIP_SELECT)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("trip_date", { ascending: false })

  if (!canViewAll) query = query.eq("driver_user_id", user.id)

  const { data, error } = await query
  if (error) {
    await logServerError({
      message: "Kunne ikke hente kjørebok for prosjekt",
      error,
      source: "action",
      route: "getProjectTripsAction",
      context: { userId: user.id, companyId, projectId, viewAll },
    })
    return []
  }

  const driverIds = Array.from(new Set((data || []).map((r) => (r as RawTripRow).driver_user_id)))
  const driverNames = new Map<string, string | null>()
  if (driverIds.length) {
    const { data: drivers } = await supabase.from("users").select("id, full_name").in("id", driverIds)
    for (const d of drivers || []) driverNames.set(d.id as string, (d.full_name as string) ?? null)
  }
  return attachDriverNames((data || []) as RawTripRow[], driverNames)
}

/** Validate and normalise a TripInput; resolves the effective driver against the
 *  caller's role (workers may only log their own trips). Returns the DB row shape. */
async function buildTripRow(
  input: TripInput,
  ctx: { userId: string; companyId: string; canManage: boolean; vehicleFuel: VehicleFuel | null }
): Promise<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tripDate)) throw new Error("Ugyldig dato")
  const distance = Number(input.distanceKm)
  if (!Number.isFinite(distance) || distance < 0) throw new Error("Distanse må være et positivt tall")

  // Workers can only register trips for themselves.
  const driverUserId = ctx.canManage ? input.driverUserId || ctx.userId : ctx.userId

  const passengers = Math.max(0, Math.floor(Number(input.passengers) || 0))
  const anleggsvei = Boolean(input.anleggsvei)
  const classification = input.classification === "private" ? "private" : "business"
  const { rateNokPerKm, amountNok } = computeTripAmount({
    distanceKm: distance,
    passengers,
    anleggsvei,
    year: yearFromDate(input.tripDate),
  })

  // Fuel-cost snapshot, derived from the chosen vehicle (never trusted from the
  // client). Mirrors the rate snapshot so historical trips stay stable.
  const fuel = computeFuelCost({
    distanceKm: distance,
    consumptionLPerMil: ctx.vehicleFuel?.consumptionLPerMil,
    fuelType: ctx.vehicleFuel?.fuelType,
  })

  return {
    company_id: ctx.companyId,
    project_id: input.projectId || null,
    driver_user_id: driverUserId,
    vehicle_id: input.vehicleId || null,
    trip_date: input.tripDate,
    start_time: input.startTime || null,
    end_time: input.endTime || null,
    from_address: input.fromAddress?.trim() || null,
    from_lat: input.fromLat ?? null,
    from_lng: input.fromLng ?? null,
    to_address: input.toAddress?.trim() || null,
    to_lat: input.toLat ?? null,
    to_lng: input.toLng ?? null,
    distance_km: distance,
    purpose: input.purpose?.trim() || null,
    classification,
    passengers,
    anleggsvei,
    rate_nok_per_km: rateNokPerKm,
    amount_nok: amountNok,
    fuel_consumption_l_per_mil: fuel.costNok > 0 ? ctx.vehicleFuel?.consumptionLPerMil ?? null : null,
    fuel_price_nok_per_liter: fuel.pricePerLiter || null,
    fuel_cost_nok: fuel.costNok,
    odometer_start: input.odometerStart ?? null,
    odometer_end: input.odometerEnd ?? null,
    route_geometry: input.routeGeometry ?? null,
    notes: input.notes?.trim() || null,
    source: input.source === "gps" ? "gps" : "manual",
  }
}

export async function createTripAction(input: TripInput): Promise<TripWithRefs> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const vehicleFuel = await getVehicleFuel(supabase, companyId!, input.vehicleId)
  const row = await buildTripRow(input, {
    userId: user.id,
    companyId: companyId!,
    canManage: canManageProjects(role),
    vehicleFuel,
  })

  const { data, error } = await supabase
    .from("kjorebok_trips")
    .insert({ ...row, created_by: user.id })
    .select(TRIP_SELECT)
    .single()

  if (error) {
    await logServerError({
      message: "Kunne ikke lagre kjøretur",
      error,
      source: "action",
      route: "createTripAction",
      context: { userId: user.id, companyId },
    })
    throw new Error("Kunne ikke lagre kjøretur")
  }

  revalidatePath("/min-bedrift/kjorebok")
  if (input.projectId) revalidatePath(`/prosjekter/${input.projectId}`)
  return attachDriverNames([data as RawTripRow], new Map())[0]
}

export async function updateTripAction(id: string, input: TripInput): Promise<TripWithRefs> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const canManage = canManageProjects(role)

  // A worker may only edit their own trips; managers/admins any in the company.
  const { data: existing, error: fetchError } = await supabase
    .from("kjorebok_trips")
    .select("id, driver_user_id, project_id, tripletex_status")
    .eq("id", id)
    .eq("company_id", companyId!)
    .maybeSingle()
  if (fetchError || !existing) throw new Error("Fant ikke kjøreturen")
  if (!canManage && existing.driver_user_id !== user.id) {
    throw new Error("Du kan bare endre dine egne kjøreturer")
  }

  const vehicleFuel = await getVehicleFuel(supabase, companyId!, input.vehicleId)
  const row = await buildTripRow(input, { userId: user.id, companyId: companyId!, canManage, vehicleFuel })
  // Editing must not leave a stale "Synket" badge: a previously synced/failed trip
  // is demoted to not_synced so the operator re-pushes the updated km/amount. The
  // Tripletex entity link is kept, so a re-sync PUTs the same reiseregning (no dup).
  const wasSynced = existing.tripletex_status === "synced" || existing.tripletex_status === "failed"
  const { data, error } = await supabase
    .from("kjorebok_trips")
    .update({
      ...row,
      updated_at: new Date().toISOString(),
      ...(wasSynced
        ? {
            tripletex_status: "not_synced",
            tripletex_external_url: null,
            tripletex_synced_at: null,
            tripletex_last_error: null,
          }
        : {}),
    })
    .eq("id", id)
    .eq("company_id", companyId!)
    .select(TRIP_SELECT)
    .single()

  if (error) {
    await logServerError({
      message: "Kunne ikke oppdatere kjøretur",
      error,
      source: "action",
      route: "updateTripAction",
      context: { userId: user.id, companyId, tripId: id },
    })
    throw new Error("Kunne ikke oppdatere kjøretur")
  }

  revalidatePath("/min-bedrift/kjorebok")
  if (existing.project_id) revalidatePath(`/prosjekter/${existing.project_id}`)
  if (input.projectId && input.projectId !== existing.project_id) {
    revalidatePath(`/prosjekter/${input.projectId}`)
  }
  return attachDriverNames([data as RawTripRow], new Map())[0]
}

export async function deleteTripAction(id: string): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const { data: existing } = await supabase
    .from("kjorebok_trips")
    .select("id, driver_user_id, project_id")
    .eq("id", id)
    .eq("company_id", companyId!)
    .maybeSingle()
  if (!existing) throw new Error("Fant ikke kjøreturen")
  if (!canManageProjects(role) && existing.driver_user_id !== user.id) {
    throw new Error("Du kan bare slette dine egne kjøreturer")
  }

  const { error } = await supabase
    .from("kjorebok_trips")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId!)

  if (error) {
    await logServerError({
      message: "Kunne ikke slette kjøretur",
      error,
      source: "action",
      route: "deleteTripAction",
      context: { userId: user.id, companyId, tripId: id },
    })
    throw new Error("Kunne ikke slette kjøretur")
  }

  revalidatePath("/min-bedrift/kjorebok")
  if (existing.project_id) revalidatePath(`/prosjekter/${existing.project_id}`)
}

/** Re-apply the current statens-sats to a trip (e.g. after a yearly rate change). */
export async function recalcTripAmountAction(id: string): Promise<TripWithRefs> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, KJOREBOK_MODULE, "Kjørebok")

  const { data: trip, error: fetchError } = await supabase
    .from("kjorebok_trips")
    .select("id, trip_date, distance_km, passengers, anleggsvei, driver_user_id")
    .eq("id", id)
    .eq("company_id", companyId!)
    .maybeSingle()
  if (fetchError || !trip) throw new Error("Fant ikke kjøreturen")
  if (!canManageProjects(role) && trip.driver_user_id !== user.id) {
    throw new Error("Du kan bare endre dine egne kjøreturer")
  }

  const { rateNokPerKm, amountNok } = computeTripAmount({
    distanceKm: Number(trip.distance_km || 0),
    passengers: Number(trip.passengers || 0),
    anleggsvei: Boolean(trip.anleggsvei),
    year: yearFromDate(trip.trip_date as string),
  })

  const { data, error } = await supabase
    .from("kjorebok_trips")
    .update({ rate_nok_per_km: rateNokPerKm, amount_nok: amountNok, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", companyId!)
    .select(TRIP_SELECT)
    .single()

  if (error) throw new Error("Kunne ikke oppdatere beløp")
  revalidatePath("/min-bedrift/kjorebok")
  return attachDriverNames([data as RawTripRow], new Map())[0]
}
