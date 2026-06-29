// Server helper: keep a project's stored geofence in sync with its site coords.
// Prefers the real cadastral boundary (teig) and falls back to a 100 m circle.
// Best-effort — never throws, so it can't break project create/update. Writes via
// the service-role client (bypasses RLS; the caller has already authorised).

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchPropertyBoundary } from "./eiendom"

export async function upsertProjectGeofence(
  companyId: string,
  projectId: string,
  lat: number | null,
  lng: number | null
): Promise<void> {
  try {
    const admin = createAdminClient()

    // No coordinates → no geofence.
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      await admin.from("project_geofences").delete().eq("project_id", projectId).eq("company_id", companyId)
      return
    }

    const boundary = await fetchPropertyBoundary(lat, lng)
    const base = {
      company_id: companyId,
      project_id: projectId,
      center_lat: lat,
      center_lng: lng,
      radius_m: 100,
      srid: 4326,
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    const row = boundary
      ? {
          ...base,
          geofence_kind: "polygon",
          polygon: boundary.polygon,
          matrikkel_kommunenr: boundary.kommunenr,
          gnr: boundary.gnr,
          bnr: boundary.bnr,
          festenr: boundary.festenr,
          polygon_source: "eiendom-api",
        }
      : {
          ...base,
          geofence_kind: "circle",
          polygon: null,
          matrikkel_kommunenr: null,
          gnr: null,
          bnr: null,
          festenr: null,
          polygon_source: null,
        }

    await admin.from("project_geofences").upsert(row, { onConflict: "project_id" })
  } catch (error) {
    console.error("upsertProjectGeofence failed", { projectId, error })
  }
}
