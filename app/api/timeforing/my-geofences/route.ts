import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { companyHasModule } from "@/lib/billing/server-modules"
import { userFromBearer } from "@/lib/timeforing/native-auth"

export const runtime = "nodejs"

// The geofences the native layer should monitor: the caller's project geofences.
// Bearer-token auth (native has no cookies). Returns circle params (center+radius)
// for on-device monitoring; the precise polygon check happens server-side on enter.
export async function GET(request: Request) {
  const auth = await userFromBearer(request)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await companyHasModule(auth.companyId, "timeforing"))) {
    return NextResponse.json({ geofences: [] })
  }

  const admin = createAdminClient()
  const { data: members } = await admin
    .from("project_members")
    .select("project_id")
    .eq("user_id", auth.userId)
  const projectIds = (members ?? []).map((m) => m.project_id as string)
  if (projectIds.length === 0) return NextResponse.json({ geofences: [] })

  const { data: rows } = await admin
    .from("project_geofences")
    .select("project_id, geofence_kind, center_lat, center_lng, radius_m, is_active, projects(name)")
    .eq("company_id", auth.companyId)
    .in("project_id", projectIds)

  const geofences = (rows ?? [])
    .filter((r) => r.is_active !== false && r.center_lat != null && r.center_lng != null)
    .map((r) => {
      const p = Array.isArray(r.projects) ? r.projects[0] : r.projects
      return {
        projectId: r.project_id as string,
        projectName: (p?.name as string) || "Prosjekt",
        centerLat: r.center_lat as number,
        centerLng: r.center_lng as number,
        // Native circle trigger is coarse; widen a little (iOS is slow under ~200 m).
        // The precise teig + 10 m check runs server-side on the enter event.
        radiusM: Math.max((r.radius_m as number) ?? 100, 120),
      }
    })

  return NextResponse.json({ geofences })
}
