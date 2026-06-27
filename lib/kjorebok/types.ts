// Shared types for the kjørebok module. Column shapes mirror db/51_kjorebok.sql.

export type TripClassification = "business" | "private"
export type TripSource = "manual" | "gps"
export type FuelType = "electric" | "diesel" | "petrol" | "hybrid" | "hydrogen" | "other"
export type TripletexTripStatus = "not_synced" | "pending" | "synced" | "failed" | "blocked"

/** [lng, lat] pair (GeoJSON order), as stored in kjorebok_trips.route_geometry. */
export type LngLat = [number, number]

export type VehicleRow = {
  id: string
  company_id: string
  name: string
  registration: string | null
  fuel_type: FuelType | null
  /** Fuel consumption in liter per mil (1 mil = 10 km). */
  fuel_consumption_l_per_mil: number | null
  default_driver: string | null
  is_active: boolean
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type VehicleInput = {
  name: string
  registration?: string | null
  fuelType?: FuelType | null
  /** Fuel consumption in liter per mil (1 mil = 10 km). */
  fuelConsumptionLPerMil?: number | null
  defaultDriver?: string | null
  isActive?: boolean
  notes?: string | null
}

export type TripRow = {
  id: string
  company_id: string
  project_id: string | null
  driver_user_id: string
  vehicle_id: string | null

  trip_date: string
  start_time: string | null
  end_time: string | null

  from_address: string | null
  from_lat: number | null
  from_lng: number | null
  to_address: string | null
  to_lat: number | null
  to_lng: number | null

  distance_km: number
  purpose: string | null
  classification: TripClassification
  passengers: number
  anleggsvei: boolean

  rate_nok_per_km: number
  amount_nok: number

  // Fuel-cost snapshot at save time (see lib/kjorebok/fuel.ts). Null/0 when the
  // trip has no vehicle, the vehicle has no consumption, or the fuel isn't
  // priced per liter (e.g. electric).
  fuel_consumption_l_per_mil: number | null
  fuel_price_nok_per_liter: number | null
  fuel_cost_nok: number

  odometer_start: number | null
  odometer_end: number | null

  route_geometry: LngLat[] | null
  notes: string | null
  source: TripSource

  tripletex_status: TripletexTripStatus
  tripletex_external_id: number | null
  tripletex_external_url: string | null
  tripletex_synced_at: string | null
  tripletex_last_error: string | null

  created_by: string | null
  created_at: string
  updated_at: string
}

/** TripRow joined with display labels for list rendering. */
export type TripWithRefs = TripRow & {
  driver_name: string | null
  project_name: string | null
  vehicle_name: string | null
}

/** Input accepted by createTripAction/updateTripAction. Amount is computed
 *  server-side from distance/passengers/anleggsvei — never sent by the client. */
export type TripInput = {
  projectId?: string | null
  driverUserId: string
  vehicleId?: string | null
  tripDate: string
  startTime?: string | null
  endTime?: string | null
  fromAddress?: string | null
  fromLat?: number | null
  fromLng?: number | null
  toAddress?: string | null
  toLat?: number | null
  toLng?: number | null
  distanceKm: number
  purpose?: string | null
  classification: TripClassification
  passengers?: number
  anleggsvei?: boolean
  odometerStart?: number | null
  odometerEnd?: number | null
  routeGeometry?: LngLat[] | null
  notes?: string | null
  source?: TripSource
}

export type TripFilter = {
  /** "YYYY-MM" — restrict to a calendar month. */
  month?: string
  driverId?: string
  projectId?: string
  classification?: TripClassification
}

export type TripTotals = {
  km: number
  amountNok: number
  /** Total estimated fuel cost (business trips). */
  fuelCostNok: number
  businessKm: number
  privateKm: number
  tripCount: number
  driverCount: number
}

export type TripsOverview = {
  canViewAll: boolean
  totals: TripTotals
  trips: TripWithRefs[]
  byProject: Array<{ projectId: string | null; projectName: string | null; km: number; amountNok: number }>
  byDriver: Array<{ driverId: string; driverName: string | null; km: number; amountNok: number }>
  drivers: Array<{ id: string; name: string | null }>
  projects: Array<{ id: string; name: string }>
  vehicles: VehicleRow[]
}

/** sessionStorage key used to hand a finished GPS draft to the dedicated
 *  "Ny tur" page (/min-bedrift/kjorebok/ny) across a client navigation. */
export const NEW_TRIP_DRAFT_KEY = "kjorebok:new-trip-draft"

/** Result of a foreground live-tracking session, used to prefill the trip form. */
export type LiveTripDraft = {
  source: "gps"
  startTime: string
  endTime: string
  distanceKm: number
  routeGeometry: LngLat[]
  fromLat: number | null
  fromLng: number | null
  fromAddress: string | null
  toLat: number | null
  toLng: number | null
  toAddress: string | null
}

// --- Geo proxy result shapes (app/api/kjorebok/*) -------------------------

export type GeocodeResult = {
  label: string
  lat: number
  lng: number
  source: "kartverket" | "maptiler"
}

export type RouteResult = {
  distanceKm: number
  durationMin: number | null
  geometry: LngLat[]
  source: "osrm" | "haversine"
}

/**
 * Route API response. The primary route's fields are mirrored at the top level
 * for backwards compatibility; `routes` holds every candidate (primary first,
 * length 1 when there are no alternatives) for the Google-Maps-style picker.
 */
export type RouteResponse = RouteResult & {
  routes: RouteResult[]
}
