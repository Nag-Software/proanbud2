import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { companyHasModule } from "@/lib/billing/server-modules"
import { logServerError } from "@/lib/errors/log"
import { userFromBearer } from "@/lib/timeforing/native-auth"
import { calculateSessionHours } from "@/lib/time-tracking"
import { distanceToAreaMeters, haversineMeters, type AreaGeometry } from "@/lib/geo/point-in-polygon"

export const runtime = "nodejs"

const BUFFER_M = 10

// Native geofence enter/exit ingest. Bearer-token auth.
// ENTER → start (or switch to) an auto session, after a precise server-side check
//         (teig polygon + 10 m, else circle + 10 m). Status 'pending' → manager approves.
// EXIT  → intentionally a no-op for the clock: leaving the site never stops billing
//         (materials runs). Forgotten sessions are closed by the auto-close cron.
export async function POST(request: Request) {
  const auth = await userFromBearer(request)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    projectId?: string
    eventType?: string
    lat?: number
    lng?: number
    accuracy?: number
    timestamp?: string
  } | null
  if (!body?.projectId || (body.eventType !== "enter" && body.eventType !== "exit")) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!(await companyHasModule(auth.companyId, "timeforing"))) {
    return NextResponse.json({ error: "Timeføring ikke aktivert" }, { status: 403 })
  }

  // The worker must be a member of the project they're checking into.
  const { data: member } = await admin
    .from("project_members")
    .select("project_id")
    .eq("project_id", body.projectId)
    .eq("user_id", auth.userId)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: "Ingen tilgang til prosjektet" }, { status: 403 })

  // Exit never stops the clock.
  if (body.eventType === "exit") {
    return NextResponse.json({ ok: true, action: "noop_exit" })
  }

  const lat = Number(body.lat)
  const lng = Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Mangler posisjon" }, { status: 400 })
  }

  try {
    // Precise geofence check.
    const { data: gf } = await admin
      .from("project_geofences")
      .select("geofence_kind, center_lat, center_lng, radius_m, polygon")
      .eq("project_id", body.projectId)
      .eq("company_id", auth.companyId)
      .maybeSingle()

    if (gf) {
      const polygon = gf.polygon as AreaGeometry | null
      let outsideBy = Infinity
      if (gf.geofence_kind === "polygon" && polygon) {
        outsideBy = distanceToAreaMeters(lng, lat, polygon)
      } else if (gf.center_lat != null && gf.center_lng != null) {
        const dc = haversineMeters(lng, lat, gf.center_lng as number, gf.center_lat as number)
        outsideBy = Math.max(0, dc - ((gf.radius_m as number) ?? 100))
      }
      if (outsideBy > BUFFER_M) {
        return NextResponse.json({ ok: false, reason: "outside", distanceM: Math.round(outsideBy) })
      }
    }

    const now = body.timestamp ? new Date(body.timestamp) : new Date()
    if (Number.isNaN(now.getTime())) {
      return NextResponse.json({ error: "Ugyldig tidspunkt" }, { status: 400 })
    }

    const { data: active } = await admin
      .from("time_entries")
      .select("id, project_id, started_at")
      .eq("user_id", auth.userId)
      .is("ended_at", null)
      .maybeSingle()

    if (active?.project_id === body.projectId) {
      return NextResponse.json({ ok: true, action: "already_active" })
    }

    // Arrived at a different project → auto-switch: close the old session.
    if (active) {
      const raw = calculateSessionHours(active.started_at as string, now)
      const hours = Math.min(24, Math.max(0.02, raw))
      await admin
        .from("time_entries")
        .update({
          ended_at: now.toISOString(),
          hours,
          entry_date: now.toISOString().slice(0, 10),
          status: "pending",
          auto_closed: true,
          updated_at: now.toISOString(),
        })
        .eq("id", active.id)
        .is("ended_at", null)
    }

    const { error } = await admin.from("time_entries").insert({
      project_id: body.projectId,
      user_id: auth.userId,
      company_id: auth.companyId,
      entry_date: now.toISOString().slice(0, 10),
      started_at: now.toISOString(),
      hours: null,
      ended_at: null,
      source: "auto",
      status: "pending",
      check_in_lat: lat,
      check_in_lng: lng,
      check_in_accuracy_m: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
    })
    if (error) {
      await logServerError({
        message: "Geofence-event: kunne ikke starte økt",
        error,
        source: "api",
        route: "POST /api/timeforing/geofence-event",
        context: { userId: auth.userId, companyId: auth.companyId, projectId: body.projectId },
      })
      return NextResponse.json({ error: "Kunne ikke starte økt" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, action: active ? "switched" : "started" })
  } catch (error) {
    await logServerError({
      message: "Geofence-event feilet",
      error,
      source: "api",
      route: "POST /api/timeforing/geofence-event",
      context: { userId: auth.userId, companyId: auth.companyId },
    })
    return NextResponse.json({ error: "Serverfeil" }, { status: 500 })
  }
}
