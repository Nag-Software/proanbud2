import { NextResponse } from "next/server"
import { z } from "zod"

import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import { haversineKm } from "@/lib/kjorebok/haversine"
import { roundOre } from "@/lib/kjorebok/rates"
import type { LngLat, RouteResponse, RouteResult } from "@/lib/kjorebok/types"

// Driving route + distance between two points. Kartverket has no open driving-
// route API, so this proxies an OSRM-compatible router (configurable via
// KJOREBOK_OSRM_URL; defaults to the public OSRM demo). On any failure it falls
// back to a straight-line haversine estimate the user can then correct.

const point = z.object({ lat: z.number(), lng: z.number() })
const bodySchema = z.object({ from: point, to: point })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId || !(await companyHasModule(companyId, "kjorebok"))) {
    return NextResponse.json(
      { error: "Kjørebok er ikke aktivert", code: "module_required" },
      { status: 403 }
    )
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }
  const { from, to } = parsed.data

  try {
    const routed = await routeOsrm(from, to)
    if (routed.length > 0) {
      // Mirror the primary route at the top level (back-compat) + expose all
      // candidates so the trip page can offer Google-Maps-style alternatives.
      return NextResponse.json({ ...routed[0], routes: routed } satisfies RouteResponse)
    }
  } catch (error) {
    await logServerError({
      message: "Ruteberegning feilet — faller tilbake til luftlinje",
      error,
      source: "api",
      route: "POST /api/kjorebok/route",
      context: { companyId },
    })
  }

  const fallback: RouteResult = {
    distanceKm: roundOre(haversineKm(from, to)),
    durationMin: null,
    geometry: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    source: "haversine",
  }
  return NextResponse.json({ ...fallback, routes: [fallback] } satisfies RouteResponse)
}

async function routeOsrm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<RouteResult[]> {
  const base = process.env.KJOREBOK_OSRM_URL?.trim() || "https://router.project-osrm.org"
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`
  // alternatives=3 asks OSRM for up to three distinct routes; it may return fewer.
  const url = `${base}/route/v1/driving/${coords}?alternatives=3&overview=full&geometries=geojson`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []
  const data = (await res.json()) as OsrmResponse
  const routes = Array.isArray(data?.routes) ? data.routes : []
  const mapped: RouteResult[] = []
  for (const route of routes) {
    const geometry = route?.geometry?.coordinates
    if (!Array.isArray(geometry) || geometry.length < 2) continue
    const distanceKm = typeof route?.distance === "number" ? route.distance / 1000 : 0
    const durationMin = typeof route?.duration === "number" ? Math.round(route.duration / 60) : null
    mapped.push({
      distanceKm: roundOre(distanceKm),
      durationMin,
      geometry: geometry as LngLat[],
      source: "osrm",
    })
  }
  return mapped
}

type OsrmResponse = {
  routes?: Array<{
    distance?: number
    duration?: number
    geometry?: { coordinates?: [number, number][] }
  }>
}
